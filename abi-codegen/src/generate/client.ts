import {
  AbiManifest,
  AbiMethod,
  AbiTypeRef,
  AbiTypeDef,
  AbiEvent,
  AbiField,
  AbiVariantDef,
} from '../model.js';
import {
  brandBaseType,
  formatIdentifier,
  generateFileBanner,
  mapRustTypeToTs,
  MAX_ALIAS_DEPTH,
  sanitizeClassName,
  toCamelCase,
} from './emit.js';

/**
 * Utility class for handling byte conversions in Calimero
 */
class CalimeroBytes {
  private data: Uint8Array;

  constructor(input: string | number[] | Uint8Array) {
    if (typeof input === 'string') {
      // Hex string
      this.data = new Uint8Array(
        input.match(/.{1,2}/g)?.map((byte) => parseInt(byte, 16)) || [],
      );
    } else if (Array.isArray(input)) {
      // Number array
      this.data = new Uint8Array(input);
    } else {
      // Uint8Array
      this.data = input;
    }
  }

  toArray(): number[] {
    return Array.from(this.data);
  }

  toUint8Array(): Uint8Array {
    return this.data;
  }

  static fromHex(hex: string): CalimeroBytes {
    return new CalimeroBytes(hex);
  }

  static fromArray(arr: number[]): CalimeroBytes {
    return new CalimeroBytes(arr);
  }

  static fromUint8Array(bytes: Uint8Array): CalimeroBytes {
    return new CalimeroBytes(bytes);
  }
}

/**
 * Convert CalimeroBytes instances to arrays for WASM compatibility
 */
function convertCalimeroBytesForWasm(obj: any): any {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (obj instanceof CalimeroBytes) {
    return obj.toArray();
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => convertCalimeroBytesForWasm(item));
  }

  if (typeof obj === 'object') {
    const result: any = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = convertCalimeroBytesForWasm(value);
    }
    return result;
  }

  return obj;
}

/**
 * Generate a typed client from a WASM-ABI v1 manifest
 * @param manifest - The parsed ABI manifest
 * @param clientName - The name of the generated client class
 * @returns Generated TypeScript client as a string
 */
export function generateClient(
  manifest: AbiManifest,
  clientName: string = 'Client',
  importPath: string = '@calimero-network/mero-react',
): string {
  // Sanitize clientName: remove spaces/special chars, preserve existing casing
  clientName = sanitizeClassName(clientName);

  // Determine if CalimeroBytes infrastructure is needed
  const anyMethodHasBytesParams = manifest.methods.some((m) =>
    hasCalimeroBytesParams(m, manifest),
  );
  const anyMethodReturnsBytes = manifest.methods.some(
    (m) => m.returns && isBytesType(m.returns, manifest),
  );
  // CalimeroBytes class itself is needed if any type/field/param/return mentions bytes
  const anyTypeUsesBytes =
    anyMethodHasBytesParams ||
    anyMethodReturnsBytes ||
    Object.values(manifest.types).some((t) => typeDefUsesBytes(t, manifest));

  const lines: string[] = [];

  // Add file banner
  lines.push(generateFileBanner().trim());
  lines.push('');

  // Add imports
  lines.push('import {');
  lines.push('  MeroJs,');

  lines.push(`} from '${importPath}';`);
  lines.push('');

  // Generate types inline
  lines.push('// Generated types');
  lines.push('');

  // Generate type definitions
  for (const [typeName, typeDef] of Object.entries(manifest.types)) {
    lines.push(
      ...generateTypeDefinition(typeName, typeDef as AbiTypeDef, manifest),
    );
    lines.push('');
  }

  // Generate method error types
  for (const method of manifest.methods) {
    if (method.errors && method.errors.length > 0) {
      lines.push(...generateMethodErrorTypes(method, manifest));
      lines.push('');
    }
  }

  // Generate event payload types
  for (const event of manifest.events) {
    lines.push(...generateEventPayloadType(event, manifest));
    lines.push('');
  }

  // Generate union type for all events
  if (manifest.events.length > 0) {
    lines.push(...generateAbiEventUnion(manifest.events, manifest));
    lines.push('');
  }

  lines.push('');

  // Add CalimeroBytes utility class (only when any type uses bytes)
  if (anyTypeUsesBytes) {
    lines.push('/**');
    lines.push(' * Utility class for handling byte conversions in Calimero');
    lines.push(' */');
    lines.push('export class CalimeroBytes {');
    lines.push('  private data: Uint8Array;');
    lines.push('');
    lines.push('  constructor(input: string | number[] | Uint8Array) {');
    lines.push('    if (typeof input === "string") {');
    lines.push('      // Hex string');
    lines.push('      this.data = new Uint8Array(');
    lines.push(
      '        input.match(/.{1,2}/g)?.map((byte) => parseInt(byte, 16)) || []',
    );
    lines.push('      );');
    lines.push('    } else if (Array.isArray(input)) {');
    lines.push('      // Number array');
    lines.push('      this.data = new Uint8Array(input);');
    lines.push('    } else {');
    lines.push('      // Uint8Array');
    lines.push('      this.data = input;');
    lines.push('    }');
    lines.push('  }');
    lines.push('');
    lines.push('  toArray(): number[] {');
    lines.push('    return Array.from(this.data);');
    lines.push('  }');
    lines.push('');
    lines.push('  toUint8Array(): Uint8Array {');
    lines.push('    return this.data;');
    lines.push('  }');
    lines.push('');
    lines.push('  static fromHex(hex: string): CalimeroBytes {');
    lines.push('    return new CalimeroBytes(hex);');
    lines.push('  }');
    lines.push('');
    lines.push('  static fromArray(arr: number[]): CalimeroBytes {');
    lines.push('    return new CalimeroBytes(arr);');
    lines.push('  }');
    lines.push('');
    lines.push('  static fromUint8Array(bytes: Uint8Array): CalimeroBytes {');
    lines.push('    return new CalimeroBytes(bytes);');
    lines.push('  }');
    lines.push('}');
    lines.push('');
  } // end if (anyTypeUsesBytes)

  // Add utility function for CalimeroBytes conversion (only when any method has bytes params)
  if (anyMethodHasBytesParams) {
    lines.push('/**');
    lines.push(
      ' * Convert CalimeroBytes instances to arrays for WASM compatibility',
    );
    lines.push(' */');
    lines.push('function convertCalimeroBytesForWasm(obj: any): any {');
    lines.push('  if (obj === null || obj === undefined) {');
    lines.push('    return obj;');
    lines.push('  }');
    lines.push('');
    lines.push('  if (obj instanceof CalimeroBytes) {');
    lines.push('    return obj.toArray();');
    lines.push('  }');
    lines.push('');
    lines.push('  if (Array.isArray(obj)) {');
    lines.push(
      '    return obj.map(item => convertCalimeroBytesForWasm(item));',
    );
    lines.push('  }');
    lines.push('');
    lines.push('  if (typeof obj === "object") {');
    lines.push('    const result: any = {};');
    lines.push('    for (const [key, value] of Object.entries(obj)) {');
    lines.push('      result[key] = convertCalimeroBytesForWasm(value);');
    lines.push('    }');
    lines.push('    return result;');
    lines.push('  }');
    lines.push('');
    lines.push('  return obj;');
    lines.push('}');
    lines.push('');
  } // end if (anyMethodHasBytesParams)

  // Add Client class
  lines.push(`export class ${clientName} {`);
  lines.push(`  private _mero: MeroJs;`);
  lines.push(`  private _contextId: string;`);
  lines.push('');
  lines.push(`  constructor(mero: MeroJs, contextId: string) {`);
  lines.push(`    this._mero = mero;`);
  lines.push(`    this._contextId = contextId;`);
  lines.push(`  }`);
  lines.push('');

  // Generate methods
  for (const method of manifest.methods) {
    lines.push(...generateMethod(method, manifest, false));
    lines.push('');
  }

  lines.push('}');

  return lines.join('\n');
}

/**
 * Check if a type reaches bytes anywhere. `seen` cuts a self-referential $ref, the
 * only way a manifest can cycle; it must start empty per query, never be shared.
 */
function isBytesType(
  typeRef: AbiTypeRef,
  manifest: AbiManifest,
  seen: Set<string> = new Set(),
): boolean {
  if ('$ref' in typeRef) {
    if (seen.has(typeRef.$ref)) return false;
    seen.add(typeRef.$ref);
    const typeDef = manifest.types[typeRef.$ref];
    if (typeDef) return typeDefUsesBytes(typeDef, manifest, seen);
  }
  if ('kind' in typeRef) {
    if (typeRef.kind === 'bytes') {
      return true;
    }
    if (typeRef.kind === 'list' && 'items' in typeRef) {
      return isBytesType(typeRef.items, manifest, seen);
    }
    if (typeRef.kind === 'map' && 'value' in typeRef) {
      return isBytesType(typeRef.value, manifest, seen);
    }
    if (typeRef.kind === 'record') {
      if (
        'crdt_type' in typeRef &&
        typeRef.crdt_type &&
        'inner_type' in typeRef &&
        typeRef.inner_type
      ) {
        return isBytesType(typeRef.inner_type, manifest, seen);
      }
      if ('fields' in typeRef) {
        return typeRef.fields.some((field: any) =>
          isBytesType(field.type, manifest, seen),
        );
      }
    }
    if (typeRef.kind === 'tuple' && 'elements' in typeRef) {
      return (typeRef as any).elements.some((el: AbiTypeRef) =>
        isBytesType(el, manifest, seen),
      );
    }
  }
  return false;
}

/**
 * Check if a type definition references bytes anywhere (including nested fields)
 */
function typeDefUsesBytes(
  typeDef: AbiTypeDef,
  manifest: AbiManifest,
  seen: Set<string> = new Set(),
): boolean {
  if (typeDef.kind === 'bytes') return true;
  if (typeDef.kind === 'record') {
    if (typeDef.crdt_type && typeDef.inner_type) {
      return isBytesType(typeDef.inner_type, manifest, seen);
    }
    return typeDef.fields.some((f) => isBytesType(f.type, manifest, seen));
  }
  if (typeDef.kind === 'variant') {
    return typeDef.variants.some(
      (v) => v.payload !== undefined && isBytesType(v.payload, manifest, seen),
    );
  }
  if (typeDef.kind === 'alias') {
    return isBytesType(typeDef.target, manifest, seen);
  }
  return false;
}

/**
 * Check if a method has any CalimeroBytes parameters
 */
function hasCalimeroBytesParams(
  method: AbiMethod,
  manifest: AbiManifest,
): boolean {
  return method.params.some((param) => isBytesType(param.type, manifest));
}

/**
 * The typedef a reference really names, following alias hops so a newtype over a
 * named type is judged by what it wraps. Bounded, since an alias can point at itself.
 */
function resolveNamedType(
  typeRef: AbiTypeRef,
  manifest: AbiManifest,
): AbiTypeDef | undefined {
  if (!('$ref' in typeRef)) return undefined;

  let ref = typeRef.$ref;
  for (let depth = 0; depth < MAX_ALIAS_DEPTH; depth++) {
    const typeDef = manifest.types[ref];
    if (!typeDef) return undefined;
    if (typeDef.kind !== 'alias' || !('$ref' in typeDef.target)) return typeDef;
    ref = typeDef.target.$ref;
  }
  return undefined;
}

/**
 * Check whether every variant in a variant typedef is unit (no payload).
 * Serde's default for such enums is to serialize as bare strings, so we
 * emit a string-literal union type rather than a discriminated union.
 */
function isAllUnitVariant(typeDef: AbiTypeDef): boolean {
  return (
    typeDef.kind === 'variant' && typeDef.variants.every((v) => !v.payload)
  );
}

/**
 * The expression decoding raw JSON in `expr` into the declared type, or null when
 * it already is that type. A $ref cycle stops here, leaving its tail raw.
 */
function decodeExpr(
  typeRef: AbiTypeRef,
  manifest: AbiManifest,
  expr: string,
  seen: Set<string> = new Set(),
): string | null {
  if ('$ref' in typeRef) {
    if (seen.has(typeRef.$ref)) return null;
    const typeDef = manifest.types[typeRef.$ref];
    if (!typeDef) return null;
    // A branch per $ref, so a type used twice among siblings decodes twice.
    return decodeTypeDef(
      typeDef,
      manifest,
      expr,
      new Set(seen).add(typeRef.$ref),
    );
  }

  switch (typeRef.kind) {
    case 'bytes':
      return `new CalimeroBytes(${expr})`;
    case 'list': {
      const item = decodeExpr(typeRef.items, manifest, 'item', seen);
      return item && `${expr}.map((item: any) => ${item})`;
    }
    case 'map': {
      const value = decodeExpr(typeRef.value, manifest, 'v', seen);
      return (
        value &&
        `Object.fromEntries(Object.entries(${expr}).map(([k, v]: [string, any]) => [k, ${value}]))`
      );
    }
    case 'tuple':
      return decodeTuple(typeRef.elements, manifest, expr, seen);
    case 'record':
      if (typeRef.crdt_type && typeRef.inner_type) {
        return decodeExpr(typeRef.inner_type, manifest, expr, seen);
      }
      return decodeRecord(typeRef.fields, manifest, expr, seen);
    default:
      return null;
  }
}

/**
 * Alias and variant are the only typedef kinds that are not also type refs.
 */
function decodeTypeDef(
  typeDef: AbiTypeDef,
  manifest: AbiManifest,
  expr: string,
  seen: Set<string>,
): string | null {
  if (typeDef.kind === 'alias') {
    return decodeExpr(typeDef.target, manifest, expr, seen);
  }
  if (typeDef.kind === 'variant') {
    return decodeVariant(typeDef, manifest, expr, seen);
  }
  return decodeExpr(typeDef, manifest, expr, seen);
}

function decodeRecord(
  fields: AbiField[],
  manifest: AbiManifest,
  expr: string,
  seen: Set<string>,
): string | null {
  const decoded = fields.flatMap((field) => {
    // Read the wire key but emit the sanitised one the interface declares. A
    // sanitised field is copied across even when it needs no decoding.
    const read = `${expr}['${field.name}']`;
    const name = formatIdentifier(field.name);
    const inner = decodeExpr(field.type, manifest, read, seen);
    if (!inner) return name === field.name ? [] : [`${name}: ${read}`];
    return field.nullable
      ? [`${name}: ${read} == null ? null : ${inner}`]
      : [`${name}: ${inner}`];
  });
  // Parenthesised so the literal still reads as an expression in an arrow body.
  return decoded.length ? `({ ...${expr}, ${decoded.join(', ')} })` : null;
}

function decodeTuple(
  elements: AbiTypeRef[],
  manifest: AbiManifest,
  expr: string,
  seen: Set<string>,
): string | null {
  const parts = elements.map((el, i) =>
    decodeExpr(el, manifest, `${expr}[${i}]`, seen),
  );
  if (parts.every((part) => part === null)) return null;
  return `[${parts.map((part, i) => part ?? `${expr}[${i}]`).join(', ')}]`;
}

/**
 * Untag serde's external tagging, the inverse of the request-side rewrite: a
 * unit member arrives as a bare string, a payload-bearing one as `{ K: v }`.
 */
function decodeVariant(
  typeDef: AbiVariantDef,
  manifest: AbiManifest,
  expr: string,
  seen: Set<string>,
): string | null {
  if (isAllUnitVariant(typeDef)) return null;

  const payloadBranches = typeDef.variants
    .map((variant) => {
      const inner =
        variant.payload &&
        decodeExpr(
          variant.payload,
          manifest,
          `${expr}['${variant.name}']`,
          seen,
        );
      return inner
        ? `'${variant.name}' in ${expr} ? { name: '${variant.name}', payload: ${inner} } : `
        : '';
    })
    .join('');

  return (
    `(typeof ${expr} === 'string' ? { name: ${expr} } : ${payloadBranches}` +
    `{ name: Object.keys(${expr})[0], payload: Object.values(${expr})[0] })`
  );
}

/**
 * Generate a single type definition
 */
function generateTypeDefinition(
  typeName: string,
  typeDef: AbiTypeDef,
  manifest: AbiManifest,
): string[] {
  const lines: string[] = [];
  const safeName = formatIdentifier(typeName);

  if (typeDef.kind === 'record') {
    lines.push(`export interface ${safeName} {`);
    for (const field of typeDef.fields) {
      const fieldType = generateTypeRef(field.type, manifest, false);
      const nullableType = field.nullable ? `${fieldType} | null` : fieldType;
      lines.push(`  ${formatIdentifier(field.name)}: ${nullableType};`);
    }
    lines.push('}');
  } else if (typeDef.kind === 'variant') {
    if (isAllUnitVariant(typeDef)) {
      // Unit-only variants — serde serializes these as bare strings.
      // Emit a string-literal union type that matches the wire format.
      const literals = typeDef.variants.map((v) => `'${v.name}'`).join(' | ');
      lines.push(`export type ${safeName} = ${literals};`);
    } else {
      // Mixed/payload variants — emit a discriminated union and factory.
      lines.push(`export type ${safeName}Payload =`);
      const variantLines = typeDef.variants.map((variant) => {
        if (variant.payload) {
          const payloadType = generateTypeRef(variant.payload, manifest, false);
          return `  | { name: '${variant.name}'; payload: ${payloadType} }`;
        } else {
          return `  | { name: '${variant.name}' }`;
        }
      });
      lines.push(...variantLines);

      // Generate factory object for variants
      lines.push('');
      lines.push(`export const ${safeName} = {`);
      typeDef.variants.forEach((variant) => {
        const variantName = formatIdentifier(variant.name);
        if (variant.payload) {
          const payloadType = generateTypeRef(variant.payload, manifest, false);
          lines.push(
            `  ${variantName}: (${formatIdentifier(variant.name.toLowerCase())}: ${payloadType}): ${safeName}Payload => ({ name: '${variant.name}', payload: ${formatIdentifier(variant.name.toLowerCase())} }),`,
          );
        } else {
          lines.push(
            `  ${variantName}: (): ${safeName}Payload => ({ name: '${variant.name}' }),`,
          );
        }
      });
      lines.push('} as const;');
    }
  } else if (typeDef.kind === 'alias') {
    const brandBase = brandBaseType(typeDef, manifest);
    if (brandBase) {
      lines.push(
        `export type ${safeName} = ${brandBase} & { readonly __brand: '${safeName}' };`,
      );
      // A pattern describes string values, so a numeric newtype brands unchecked.
      // The regex is built from source text rather than inlined as a literal so a
      // `/` in the pattern cannot terminate it early.
      if (brandBase === 'string' && typeDef.pattern) {
        const source = JSON.stringify(typeDef.pattern);
        const message = JSON.stringify(
          `${safeName} must match ${typeDef.pattern}`,
        );
        lines.push(
          `export const ${safeName} = (value: ${brandBase}): ${safeName} => {`,
          `  if (!new RegExp(${source}).test(value)) {`,
          `    throw new TypeError(${message});`,
          `  }`,
          `  return value as ${safeName};`,
          `};`,
        );
      } else {
        lines.push(
          `export const ${safeName} = (value: ${brandBase}): ${safeName} => value as ${safeName};`,
        );
      }
    } else {
      const targetType = generateTypeRef(typeDef.target, manifest, false);
      lines.push(`export type ${safeName} = ${targetType};`);
    }
  }

  return lines;
}

/**
 * Generate error types for a method
 */
function generateMethodErrorTypes(
  method: AbiMethod,
  manifest: AbiManifest,
): string[] {
  const lines: string[] = [];
  const methodName = formatIdentifier(method.name);

  // Generate error code type
  const errorCodes = method
    .errors!.map((error) => `"${error.code}"`)
    .join(' | ');
  lines.push(`export type ${methodName}ErrorCode = ${errorCodes};`);

  // Generate error union type
  lines.push(
    `export type ${methodName}Error = { code: ${methodName}ErrorCode } & (`,
  );

  const errorVariants = method.errors!.map((error) => {
    if (error.payload) {
      const payloadType = generateTypeRef(error.payload, manifest);
      return `  | { code: "${error.code}"; payload: ${payloadType} }`;
    } else {
      return `  | { code: "${error.code}" }`;
    }
  });

  lines.push(...errorVariants);
  lines.push(');');

  return lines;
}

/**
 * Generate event payload type
 */
function generateEventPayloadType(
  event: AbiEvent,
  manifest: AbiManifest,
): string[] {
  const lines: string[] = [];
  const eventName = formatIdentifier(event.name);

  // Only generate payload type if event has a payload and it's not unit
  if (
    event.payload &&
    !('$ref' in event.payload) &&
    event.payload.kind !== 'unit'
  ) {
    const payloadType = generateTypeRef(event.payload, manifest);
    lines.push(`export type ${eventName}Payload = ${payloadType};`);
  }

  return lines;
}

/**
 * Generate union type for all events
 */
function generateAbiEventUnion(
  events: AbiEvent[],
  manifest: AbiManifest,
): string[] {
  const lines: string[] = [];

  lines.push('export type AbiEvent =');
  const eventLines = events.map((event) => {
    // Inline unit means "no data" — omit the payload field
    const isInlineUnit =
      event.payload &&
      !('$ref' in event.payload) &&
      event.payload.kind === 'unit';
    if (event.payload && !isInlineUnit) {
      const payloadType = generateTypeRef(event.payload, manifest);
      return `  | { name: "${event.name}"; payload: ${payloadType} }`;
    } else {
      return `  | { name: "${event.name}" }`;
    }
  });
  lines.push(...eventLines);
  lines.push(';');

  return lines;
}

/**
 * Generate a single method
 */
function generateMethod(
  method: AbiMethod,
  manifest: AbiManifest,
  useTypesNamespace: boolean = false,
): string[] {
  const lines: string[] = [];
  const methodName = toCamelCase(method.name);

  // Generate JSDoc comment
  lines.push('  /**');
  lines.push(`   * ${method.name}`);

  // Surface the app-declared read/write intent when present. mero-js has no
  // read transport yet, so this is documentation only — not a routing hint.
  if (method.intent && method.intent !== 'unspecified') {
    lines.push('   *');
    lines.push(`   * @intent ${method.intent}`);
  }

  // Cross-context entry point. The node enforces the caller policy, and an
  // absent `xcall_callers` means `any_in_namespace`, so state it either way —
  // nothing else in the emitted signature distinguishes these methods.
  if (method.xcall_callable) {
    const callers = method.xcall_callers ?? 'any_in_namespace';
    const note =
      callers === 'same_app'
        ? 'callers must run the same application id'
        : 'callable by any context in the namespace';
    lines.push('   *');
    lines.push(`   * @xcall ${callers} (${note})`);
  }

  // Declared migration edge. The node drives these during an upgrade; app code
  // calling one directly is almost always a mistake.
  const migration = manifest.migrations?.find((m) => m.method === method.name);
  if (migration) {
    lines.push('   *');
    lines.push(
      `   * @migration from state version ${migration.fromVersion} to ${migration.fromVersion + 1} — invoked by the node during upgrade, not by app code`,
    );
  }

  // Add error documentation if method has errors
  if (method.errors && method.errors.length > 0) {
    lines.push('   *');
    // Generate specific error type name
    const errorTypeName = `${method.name}Error`;
    const errorTypeRef = useTypesNamespace
      ? `Types.${errorTypeName}`
      : errorTypeName;
    lines.push(
      `   * @throws {${errorTypeRef}} May throw the following errors:`,
    );
    for (const error of method.errors) {
      if (error.payload) {
        lines.push(
          `   * - ${error.code}: ${generateTypeRef(error.payload, manifest, useTypesNamespace)}`,
        );
      } else {
        lines.push(`   * - ${error.code}`);
      }
    }
  }

  lines.push('   */');

  // Generate method signature and body
  const returnType = method.returns
    ? generateTypeRef(method.returns, manifest, useTypesNamespace, true)
    : 'void';
  const nullableReturnType = method.returns_nullable
    ? `${returnType} | null`
    : returnType;
  const decode = method.returns
    ? decodeExpr(method.returns, manifest, 'response')
    : null;
  // A void method never reads the rpc response, so skip the binding -
  // `const response` would otherwise trip noUnusedLocals.
  const responseDecl = method.returns
    ? decode
      ? 'const response: any = ' // rpc.execute resolves to `unknown`, unwalkable
      : 'const response = '
    : '';

  if (method.params.length === 0) {
    // No parameters - expose method with no arguments and pass empty object
    lines.push(
      `  public async ${methodName}(): Promise<${nullableReturnType}> {`,
    );
    lines.push(
      `    ${responseDecl}await this._mero.rpc.execute({ contextId: this._contextId, method: '${method.name}', argsJson: {} });`,
    );
  } else {
    // 1+ parameters - build object type and expose single params argument
    const paramsTypeFields = method.params.map((param) => {
      const paramType = generateTypeRef(
        param.type,
        manifest,
        useTypesNamespace,
        true,
      );
      const nullableType = param.nullable ? `${paramType} | null` : paramType;
      return `${formatIdentifier(param.name)}: ${nullableType}`;
    });

    lines.push(
      `  public async ${methodName}(params: { ${paramsTypeFields.join('; ')} }): Promise<${nullableReturnType}> {`,
    );

    // A payload-bearing variant is emitted as a `{ name, payload }` union, but
    // serde expects `{ Variant: payload }`, so rewrite those params before the call.
    const variantParams = method.params.filter((param) => {
      const typeDef = resolveNamedType(param.type, manifest);
      return (
        typeDef !== undefined &&
        typeDef.kind === 'variant' &&
        !isAllUnitVariant(typeDef)
      );
    });

    if (variantParams.length > 0) {
      lines.push(
        `    // Serde tags a payload-bearing variant as { Variant: payload }`,
      );
      lines.push(`    const convertedParams = { ...params } as any;`);
      for (const param of variantParams) {
        const paramName = formatIdentifier(param.name);
        lines.push(
          `    if (convertedParams.${paramName} && typeof convertedParams.${paramName} === 'object' && 'name' in convertedParams.${paramName}) {`,
          `      if ('payload' in convertedParams.${paramName}) {`,
          `        convertedParams.${paramName} = { [convertedParams.${paramName}.name]: convertedParams.${paramName}.payload };`,
          `      } else {`,
          `        convertedParams.${paramName} = convertedParams.${paramName}.name;`,
          `      }`,
          `    }`,
        );
      }
    }

    const args = variantParams.length > 0 ? 'convertedParams' : 'params';
    const argsJson = hasCalimeroBytesParams(method, manifest)
      ? `convertCalimeroBytesForWasm(${args})`
      : args;
    lines.push(
      `    ${responseDecl}await this._mero.rpc.execute({ contextId: this._contextId, method: '${method.name}', argsJson: ${argsJson} });`,
    );
  }

  // rpc.execute<T>() returns T directly or throws RpcError — no wrapper
  // Guard null unconditionally: a node can answer null the manifest never declared.
  if (method.returns) {
    lines.push(
      decode
        ? `    return (response == null ? null : ${decode}) as ${nullableReturnType};`
        : `    return response as ${nullableReturnType};`,
    );
  }
  lines.push(`  }`);

  return lines;
}

/**
 * Generate TypeScript type from an ABI type reference
 * @param forUserApi - If true, return string for hex bytes types instead of Uint8Array
 */
function generateTypeRef(
  typeRef: AbiTypeRef,
  manifest: AbiManifest,
  useTypesNamespace: boolean = false,
  forUserApi: boolean = false,
): string {
  if ('$ref' in typeRef) {
    const typeDef = manifest.types[typeRef.$ref];

    // If not a known type in the manifest, try mapping as a raw Rust type
    if (!typeDef) {
      const mapped = mapRustTypeToTs(typeRef.$ref);
      if (mapped) return mapped;
    }

    const typeName = formatIdentifier(typeRef.$ref);

    // Check if this is a bytes type
    if (typeDef && typeDef.kind === 'bytes') {
      return 'CalimeroBytes'; // Return CalimeroBytes for bytes types
    }

    // For variant types, choose between string-literal union and discriminated
    // union based on whether all variants are unit (no payload):
    //   - all-unit  → bare name is the type alias (e.g. type Status = 'A' | 'B')
    //   - mixed     → use {Name}Payload (the discriminated union)
    if (typeDef && typeDef.kind === 'variant') {
      if (isAllUnitVariant(typeDef)) {
        return useTypesNamespace ? `Types.${typeName}` : typeName;
      }
      const payloadType = useTypesNamespace
        ? `Types.${typeName}Payload`
        : `${typeName}Payload`;
      return payloadType;
    }

    return useTypesNamespace ? `Types.${typeName}` : typeName;
  }

  switch (typeRef.kind) {
    case 'bool':
      return 'boolean';
    case 'i32':
    case 'i64':
    case 'u32':
    case 'u64':
    case 'f32':
    case 'f64':
      return 'number';
    case 'string':
      return 'string';
    case 'unit':
      return 'void';
    case 'bytes':
      return 'CalimeroBytes'; // Return CalimeroBytes for bytes types
    case 'list':
      const itemType = generateTypeRef(
        typeRef.items,
        manifest,
        useTypesNamespace,
        forUserApi,
      );
      // Wrap union types in parens so `string | null[]` becomes `(string | null)[]`
      const needsParens = itemType.includes('|');
      return needsParens ? `(${itemType})[]` : `${itemType}[]`;
    case 'map':
      const keyType = generateTypeRef(
        typeRef.key,
        manifest,
        useTypesNamespace,
        forUserApi,
      );
      const valueType = generateTypeRef(
        typeRef.value,
        manifest,
        useTypesNamespace,
        forUserApi,
      );
      return `Record<${keyType}, ${valueType}>`;
    case 'tuple':
      const elements = (typeRef as any).elements.map((el: AbiTypeRef) =>
        generateTypeRef(el, manifest, useTypesNamespace, forUserApi),
      );
      return `[${elements.join(', ')}]`;
    case 'record':
      if (typeRef.crdt_type && typeRef.inner_type) {
        return generateTypeRef(
          typeRef.inner_type,
          manifest,
          useTypesNamespace,
          forUserApi,
        );
      }
      const fields = typeRef.fields.map((field) => {
        const fieldType = generateTypeRef(
          field.type,
          manifest,
          useTypesNamespace,
          forUserApi,
        );
        const nullableType = field.nullable ? `${fieldType} | null` : fieldType;
        return `${formatIdentifier(field.name)}: ${nullableType}`;
      });
      return `{ ${fields.join('; ')} }`;
    default:
      throw new Error(`Unsupported type kind: ${(typeRef as any).kind}`);
  }
}
