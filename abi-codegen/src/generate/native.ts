/**
 * What the Swift and Kotlin emitters share: type mapping, naming and routing.
 *
 * The wire shape is the TypeScript client's, which is the source of truth:
 * integers are JSON numbers, bytes are arrays of numbers (fixed-size bytes, such
 * as a 32-byte `UserId`, are text in the contract's own encoding — base58 or hex
 * — and pass through as strings), maps are objects and
 * enums follow serde's tagging. The one deliberate difference is that an absent
 * optional argument is left out of the args object rather than sent as `null`;
 * serde reads a missing `Option` as `None`, the same as `null`.
 */
import {
  AbiManifest,
  AbiMethod,
  AbiRecord,
  AbiTypeDef,
  AbiTypeRef,
  AbiVariantDef,
} from '../model.js';
import { formatIdentifier, MAX_ALIAS_DEPTH } from './emit.js';

type ScalarKind =
  | 'bool'
  | 'i32'
  | 'i64'
  | 'u32'
  | 'u64'
  | 'f32'
  | 'f64'
  | 'string';

// How one target language spells the ABI's building blocks.
export interface NativeSyntax {
  scalars: Record<ScalarKind, string>;
  // Raw Rust names a hand-written manifest can put in a `$ref`.
  rustScalars: Record<string, string>;
  // serde's unit (`null`) where a value is required, e.g. a record field.
  unit: string;
  bytes: string;
  // Fixed-size bytes (`[u8; N]` ids): a string, kept exactly as the contract spells it.
  fixedBytes: string;
  list(item: string): string;
  map(key: string, value: string): string;
  optional(type: string): string;
  tuple(elements: string[]): string;
}

// A record declared inline (not under `types`), given a name so it can be emitted.
export interface InlineRecord {
  name: string;
  record: AbiRecord;
}

/**
 * Maps ABI type references to one language's type expressions. Inline records,
 * tuple arities and value-position units are collected as they are met, so the
 * emitter knows which helper declarations the file needs.
 */
export class NativeTypes {
  readonly inlineRecords: InlineRecord[] = [];
  readonly tupleArities = new Set<number>();
  usesUnit = false;
  private readonly inlineByShape = new Map<string, string>();
  private readonly takenNames: Set<string>;

  constructor(
    readonly manifest: AbiManifest,
    private readonly syntax: NativeSyntax,
  ) {
    this.takenNames = new Set(
      Object.keys(manifest.types).map((name) => typeName(name)),
    );
  }

  /**
   * The type expression for `ref`. `hint` names an inline record found inside,
   * e.g. `PostAuthor` for a record declared inline on `Post.author`.
   */
  typeRef(ref: AbiTypeRef, hint: string): string {
    const s = this.syntax;
    if ('$ref' in ref) {
      if (this.manifest.types[ref.$ref]) return typeName(ref.$ref);
      return this.rustType(ref.$ref) ?? typeName(ref.$ref);
    }
    switch (ref.kind) {
      case 'bool':
      case 'i32':
      case 'i64':
      case 'u32':
      case 'u64':
      case 'f32':
      case 'f64':
      case 'string':
        return s.scalars[ref.kind];
      case 'unit':
        this.usesUnit = true;
        return s.unit;
      case 'bytes':
        return 'size' in ref && ref.size !== undefined ? s.fixedBytes : s.bytes;
      case 'list':
        return s.list(this.typeRef(ref.items, `${hint}Item`));
      case 'map':
        return s.map(
          this.mapKey(ref.key),
          this.typeRef(ref.value, `${hint}Value`),
        );
      case 'tuple':
        this.tupleArities.add(ref.elements.length);
        return s.tuple(
          ref.elements.map((el, i) => this.typeRef(el, `${hint}${i}`)),
        );
      case 'record':
        // A CRDT wrapper is its inner type on the wire, as in the TS client.
        if (ref.crdt_type && ref.inner_type) {
          return this.typeRef(ref.inner_type, hint);
        }
        return this.inlineRecord(ref, hint);
      default:
        throw new Error(`Unsupported type kind: ${(ref as any).kind}`);
    }
  }

  /**
   * A map key's type. JSON object keys are strings, so a key that is not a
   * string (or a newtype over one) is typed as a string and carries the
   * value's text, e.g. `"42"` for a `u64` key, which is what serde writes.
   */
  mapKey(ref: AbiTypeRef): string {
    return resolvesToString(ref, this.manifest)
      ? this.typeRef(ref, 'Key')
      : this.syntax.scalars.string;
  }

  /** Whether `ref` is an inline unit, which as a payload or return means "no data". */
  static isUnit(ref: AbiTypeRef | undefined): boolean {
    return ref !== undefined && !('$ref' in ref) && ref.kind === 'unit';
  }

  private inlineRecord(record: AbiRecord, hint: string): string {
    const shape = JSON.stringify(record);
    const known = this.inlineByShape.get(shape);
    if (known) return known;
    let name = typeName(hint);
    for (let n = 2; this.takenNames.has(name); n++) {
      name = `${typeName(hint)}${n}`;
    }
    this.takenNames.add(name);
    this.inlineByShape.set(shape, name);
    this.inlineRecords.push({ name, record });
    return name;
  }

  // Primitives, Vec<T>, Option<T> and Result<T, E> spelled as Rust source.
  private rustType(rust: string): string | null {
    const s = this.syntax;
    const trimmed = rust.trim();
    if (trimmed === '()') {
      this.usesUnit = true;
      return s.unit;
    }
    if (s.rustScalars[trimmed]) return s.rustScalars[trimmed];
    const vec = trimmed.match(/^Vec<(.+)>$/);
    if (vec) {
      const inner = this.rustType(vec[1]);
      return inner && s.list(inner);
    }
    const option = trimmed.match(/^Option<(.+)>$/);
    if (option) {
      const inner = this.rustType(option[1]);
      return inner && s.optional(inner);
    }
    const result = trimmed.match(/^Result<([^,<>]+(?:<.+>)?),.+>$/);
    if (result) return this.rustType(result[1]);
    return null;
  }
}

// An ABI type name as a declared type name; ABI names are already PascalCase.
export function typeName(name: string): string {
  const safe = formatIdentifier(name);
  return /^[0-9]/.test(safe) ? `_${safe}` : safe;
}

function words(name: string): string[] {
  return name
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((word) =>
      // ALL_CAPS words read as one word: `MAX_LEN` -> maxLen, not mAXLEN.
      word.length > 1 && word === word.toUpperCase() && /[A-Z]/.test(word)
        ? word.toLowerCase()
        : word,
    );
}

/** `post_id` -> `postId`, `SetName` -> `setName`. */
export function lowerCamel(name: string): string {
  const joined = words(name)
    .map((word, i) =>
      i === 0
        ? word.charAt(0).toLowerCase() + word.slice(1)
        : word.charAt(0).toUpperCase() + word.slice(1),
    )
    .join('');
  if (!joined) return '_';
  return /^[0-9]/.test(joined) ? `_${joined}` : joined;
}

/** `post_id` -> `PostId`, `rect` -> `Rect`. */
export function upperCamel(name: string): string {
  const lower = lowerCamel(name);
  return lower.startsWith('_')
    ? lower
    : lower.charAt(0).toUpperCase() + lower.slice(1);
}

/**
 * Where a call goes. Only a method the app declared `read_only` is a view; an
 * absent or `unspecified` intent is a write, which is how the node treats it.
 */
export function methodRoute(method: AbiMethod): 'query' | 'execute' {
  return method.intent === 'read_only' ? 'query' : 'execute';
}

/** Whether a method returns a value the client should decode. */
export function hasReturnValue(method: AbiMethod): boolean {
  return method.returns !== undefined && !NativeTypes.isUnit(method.returns);
}

/**
 * The typedef a name refers to after alias hops, so a newtype over an enum is
 * judged by the enum. Bounded, since an alias can point at itself.
 */
export function resolveTypeDef(
  ref: AbiTypeRef,
  manifest: AbiManifest,
): AbiTypeDef | AbiTypeRef | undefined {
  let current: AbiTypeRef | AbiTypeDef = ref;
  for (let depth = 0; depth < MAX_ALIAS_DEPTH; depth++) {
    if (!('$ref' in current)) {
      if (current.kind !== 'alias') return current;
      current = current.target;
      continue;
    }
    const next: AbiTypeDef | undefined = manifest.types[current.$ref];
    if (!next) return undefined;
    current = next;
  }
  return undefined;
}

function resolvesToString(ref: AbiTypeRef, manifest: AbiManifest): boolean {
  if ('$ref' in ref && !manifest.types[ref.$ref]) {
    return ref.$ref.trim() === 'String';
  }
  const resolved = resolveTypeDef(ref, manifest);
  return (
    resolved !== undefined && 'kind' in resolved && resolved.kind === 'string'
  );
}

/** The serde representation of an enum, as the ABI declares it. */
export function variantStyle(
  def: AbiVariantDef,
): 'unit' | 'external' | 'internal' | 'adjacent' | 'untagged' {
  if (def.untagged) return 'untagged';
  if (def.tag && def.content) return 'adjacent';
  if (def.tag) return 'internal';
  // An inline unit payload is no payload: serde writes the bare name.
  return def.variants.every((v) => !v.payload || NativeTypes.isUnit(v.payload))
    ? 'unit'
    : 'external';
}

/** Doc text as lines, with Windows and old Mac line endings normalised. */
export function docLines(doc: string): string[] {
  return doc.split(/\r\n?|\n/);
}

/** Method notes that the signature cannot say, shared by both targets. */
export function methodNotes(
  method: AbiMethod,
  manifest: AbiManifest,
): string[] {
  const notes: string[] = [];
  const route = methodRoute(method);
  notes.push(
    route === 'query'
      ? 'View (`read_only`): sent with `query`.'
      : `Write (${method.intent ? `\`${method.intent}\`` : 'no declared intent'}): sent with \`execute\`.`,
  );
  const remarks = [
    method.destructive && 'destructive',
    method.idempotent && 'idempotent',
    method.handler && 'handler',
  ].filter(Boolean);
  if (remarks.length > 0) notes.push(`Remarks: ${remarks.join(', ')}.`);
  if (method.xcall_callable) {
    const callers = method.xcall_callers ?? 'any_in_namespace';
    notes.push(
      callers === 'same_app'
        ? 'Cross-context entry point: callers must run the same application id.'
        : 'Cross-context entry point: callable by any context in the namespace.',
    );
  }
  if (method.tee_every_secs !== undefined) {
    notes.push(
      `TEE timer every ${method.tee_every_secs}s: fired by the node's TEE scheduler; other callers are refused.`,
    );
  }
  const migration = manifest.migrations?.find((m) => m.method === method.name);
  if (migration) {
    notes.push(
      `Migration from state version ${migration.fromVersion} to ${migration.fromVersion + 1}: invoked by the node during upgrade, not by app code.`,
    );
  }
  if (method.errors && method.errors.length > 0) {
    notes.push(
      `Errors: ${method.errors.map((error) => `\`${error.code}\``).join(', ')}.`,
    );
  }
  return notes;
}
