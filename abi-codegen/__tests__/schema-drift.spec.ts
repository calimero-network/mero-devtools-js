import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

// Seam A — semantic drift guard between abi-codegen's bundled schema and core's
// wasm-abi.schema.json. The bundled schema is shipped data; if core relaxes a
// constraint or adds a field and this copy lags, every new manifest is rejected
// at parse time. This test fails loudly on any semantic divergence except the
// two known, intentional ones documented below.

const __dirname = dirname(fileURLToPath(import.meta.url));
const bundledSchemaPath = join(
  __dirname,
  '../src/schema/wasm-abi-v1.schema.json',
);
const vendoredCoreSchemaPath = join(
  __dirname,
  '../__fixtures__/corpus/wasm-abi.schema.json',
);

// The two intentional divergences between abi-codegen's bundled schema and
// core's, matched by CONTENT rather than array position — a positional allowlist
// (e.g. `.../oneOf/3`) silently breaks when core reorders a `oneOf`. Each branch
// is removed from whichever schema carries it before the comparison, so the
// remainder must match exactly.
const KNOWN_DEVIATIONS: {
  label: string;
  location: string[];
  match: (branch: any) => boolean;
  reason: string;
}[] = [
  {
    label: 'abi-codegen-only `tuple` CollectionType branch',
    location: ['definitions', 'CollectionType', 'oneOf'],
    match: (b) => b?.properties?.kind?.const === 'tuple',
    reason:
      'abi-codegen extension: a `tuple` collection branch. Core rejects tuples ' +
      'during normalization so never emits one; the extra branch only widens ' +
      'what abi-codegen accepts and cannot reject a valid core ABI.',
  },
  {
    label: 'core-only VariableBytesType $ref in TypeDef',
    location: ['definitions', 'TypeDef', 'oneOf'],
    match: (b) => b?.['$ref'] === '#/definitions/VariableBytesType',
    reason:
      "core-only dangling $ref to #/definitions/VariableBytesType, which core's " +
      'schema never defines and whose Rust enum has no counterpart. Variable ' +
      'bytes are already covered by the BytesType branch (optional size). AJV ' +
      'would fail to compile the missing ref, so abi-codegen omits the branch.',
  },
];

const STRIP_KEYS = new Set(['description', 'title', '$comment']);
// JSON-Schema combinators whose element order carries no meaning.
const ORDER_INSENSITIVE = new Set([
  'enum',
  'required',
  'oneOf',
  'anyOf',
  'allOf',
]);

const canon = (x: unknown): string => JSON.stringify(x);

// Drop human-facing annotations and impose a stable order on order-insensitive
// arrays so only real structural/semantic differences survive.
function normalize(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(normalize);
  if (node && typeof node === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node)) {
      if (STRIP_KEYS.has(key)) continue;
      out[key] = normalize(value);
    }
    for (const key of ORDER_INSENSITIVE) {
      if (Array.isArray(out[key])) {
        out[key] = [...(out[key] as unknown[])].sort((a, b) =>
          canon(a) < canon(b) ? -1 : canon(a) > canon(b) ? 1 : 0,
        );
      }
    }
    return out;
  }
  return node;
}

// Remove the documented deviations by content; the remainder must match exactly.
function stripDeviations(schema: any): any {
  for (const dev of KNOWN_DEVIATIONS) {
    let node: any = schema;
    for (const key of dev.location.slice(0, -1)) node = node?.[key];
    const arrKey = dev.location[dev.location.length - 1];
    if (node && Array.isArray(node[arrKey])) {
      node[arrKey] = node[arrKey].filter((b: unknown) => !dev.match(b));
    }
  }
  return schema;
}

// Recursive structural diff producing granular JSON-pointer paths for a clear
// failure message. Order-insensitive arrays are already sorted by normalize(),
// so index-wise comparison here is stable; length/key mismatches are labelled
// with the side they are missing from rather than collapsed to one path.
function diffPaths(a: any, b: any, path: string, out: string[]): void {
  if (canon(a) === canon(b)) return;
  if (
    a === undefined ||
    b === undefined ||
    a === null ||
    b === null ||
    typeof a !== typeof b ||
    typeof a !== 'object'
  ) {
    out.push(path || '/');
    return;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) {
      out.push(`${path} (array vs non-array)`);
      return;
    }
    const n = Math.max(a.length, b.length);
    for (let i = 0; i < n; i++) {
      if (i >= a.length) out.push(`${path}/${i} (only in core)`);
      else if (i >= b.length) out.push(`${path}/${i} (only in bundled)`);
      else diffPaths(a[i], b[i], `${path}/${i}`, out);
    }
    return;
  }
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if (!(key in a)) out.push(`${path}/${key} (only in core)`);
    else if (!(key in b)) out.push(`${path}/${key} (only in bundled)`);
    else diffPaths(a[key], b[key], `${path}/${key}`, out);
  }
}

function loadComparable(path: string): unknown {
  return stripDeviations(normalize(JSON.parse(readFileSync(path, 'utf-8'))));
}

describe('Schema drift check (abi-codegen vs core)', () => {
  it('matches core exactly outside the documented deviations', () => {
    const bundled = loadComparable(bundledSchemaPath);
    const vendoredCore = loadComparable(vendoredCoreSchemaPath);

    const paths: string[] = [];
    diffPaths(bundled, vendoredCore, '', paths);

    expect(
      paths,
      'Bundled schema has drifted from core wasm-abi.schema.json. Update ' +
        'src/schema/wasm-abi-v1.schema.json to match (and re-run ' +
        '`node scripts/sync-corpus.mjs`), or document a new entry in ' +
        `KNOWN_DEVIATIONS. Divergent paths: ${JSON.stringify(paths)}`,
    ).toEqual([]);
  });

  // Staleness guard: when a core checkout is present, the vendored snapshot must
  // be byte-identical to live core's schema (raw, including descriptions). This
  // is intentionally STRICTER than the drift test above — its job is to detect
  // that someone edited core without re-running sync, so any change at all,
  // cosmetic or not, should force a re-sync. CI without a core checkout skips it.
  const coreDir = resolve(
    process.env.CALIMERO_CORE_DIR || join(__dirname, '../../../core'),
  );
  const liveCoreSchema = join(coreDir, 'crates/wasm-abi/wasm-abi.schema.json');

  it.runIf(existsSync(liveCoreSchema))(
    'vendored core schema is in sync with the live core checkout',
    () => {
      const live = JSON.parse(readFileSync(liveCoreSchema, 'utf-8'));
      const vendored = JSON.parse(
        readFileSync(vendoredCoreSchemaPath, 'utf-8'),
      );
      expect(
        live,
        'Vendored __fixtures__/corpus/wasm-abi.schema.json is stale vs the core ' +
          'checkout. Re-run `node scripts/sync-corpus.mjs` and commit.',
      ).toEqual(vendored);
    },
  );
});
