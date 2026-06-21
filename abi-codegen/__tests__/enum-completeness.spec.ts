import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

// TS-side mirror of core's Rust Layer-1 guards
// (json_schema_intent_enum_matches_method_intent and
// json_schema_crdt_enum_matches_crdt_collection_type in
// core/crates/wasm-abi/src/schema.rs). The canonical sets below INTENTIONALLY
// mirror the Rust enums MethodIntent and CrdtCollectionType by hand — they are
// the manual checkpoint. A new core variant makes core's exhaustive Rust match
// fail to compile, forcing core's schema to gain the value; re-syncing then makes
// the vendored-core assertions here go RED until abi-codegen's bundled schema AND
// these canonical lists are updated too. (The bundled-vs-core test below also
// catches divergence between the two schemas independently of these lists.)

const __dirname = dirname(fileURLToPath(import.meta.url));

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

// Mirrors CrdtCollectionType (snake_case serde tags).
const CANONICAL_CRDT_TYPES = [
  'lww_register',
  'counter',
  'vector',
  'unordered_map',
  'sorted_map',
  'authored_map',
  'unordered_set',
  'sorted_set',
  'replicated_growable_array',
  'authored_vector',
  'shared_storage',
];

// Mirrors MethodIntent (snake_case serde tags).
const CANONICAL_METHOD_INTENTS = ['read_only', 'mutating', 'unspecified'];

// Lazy, cached loads so a missing/malformed schema fails inside a test (as a
// normal assertion) rather than crashing the whole module at import time.
const cache = new Map<string, Json>();
function load(rel: string): Json {
  let v = cache.get(rel);
  if (v === undefined) {
    v = JSON.parse(readFileSync(join(__dirname, rel), 'utf-8')) as Json;
    cache.set(rel, v);
  }
  return v;
}
const bundled = (): Json => load('../src/schema/wasm-abi-v1.schema.json');
const vendoredCore = (): Json =>
  load('../__fixtures__/corpus/wasm-abi.schema.json');

// Navigate to an enum array; throws a clear error (failing the calling test) if
// the path is absent or not an array. No `any`, no assertions inside the helper.
function enumAt(schema: Json, path: string[]): string[] {
  let node: Json = schema;
  for (const key of path) {
    if (
      node === null ||
      typeof node !== 'object' ||
      Array.isArray(node) ||
      !(key in node)
    ) {
      throw new Error(`schema path missing: ${path.join('.')}`);
    }
    node = node[key];
  }
  if (!Array.isArray(node)) {
    throw new Error(`schema path is not an array: ${path.join('.')}`);
  }
  return node.map(String).sort();
}

const sorted = (xs: string[]): string[] => [...xs].sort();
const CRDT_PATH = ['definitions', 'CrdtType', 'enum'];
const INTENT_PATH = ['definitions', 'Method', 'properties', 'intent', 'enum'];

describe('Enum completeness (CrdtType + Method.intent mirror core)', () => {
  it("bundled CrdtType enum equals core's CrdtCollectionType", () => {
    expect(enumAt(bundled(), CRDT_PATH)).toEqual(sorted(CANONICAL_CRDT_TYPES));
  });

  it('vendored core CrdtType enum equals CrdtCollectionType', () => {
    expect(enumAt(vendoredCore(), CRDT_PATH)).toEqual(
      sorted(CANONICAL_CRDT_TYPES),
    );
  });

  it("bundled Method.intent enum equals core's MethodIntent", () => {
    expect(enumAt(bundled(), INTENT_PATH)).toEqual(
      sorted(CANONICAL_METHOD_INTENTS),
    );
  });

  it('vendored core Method.intent enum equals MethodIntent', () => {
    expect(enumAt(vendoredCore(), INTENT_PATH)).toEqual(
      sorted(CANONICAL_METHOD_INTENTS),
    );
  });

  it('bundled and core enums agree with each other', () => {
    expect(enumAt(bundled(), CRDT_PATH)).toEqual(
      enumAt(vendoredCore(), CRDT_PATH),
    );
    expect(enumAt(bundled(), INTENT_PATH)).toEqual(
      enumAt(vendoredCore(), INTENT_PATH),
    );
  });
});
