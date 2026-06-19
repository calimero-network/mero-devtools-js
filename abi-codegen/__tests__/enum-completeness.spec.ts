import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

// TS-side mirror of core's Rust Layer-1 guards
// (json_schema_intent_enum_matches_method_intent and
// json_schema_crdt_enum_matches_crdt_collection_type in
// core/crates/wasm-abi/src/schema.rs). The canonical sets below mirror the
// Rust enums MethodIntent and CrdtCollectionType. A new core variant makes
// core's exhaustive Rust match fail to compile, forcing core's schema to gain
// the value; re-syncing then makes the vendored-core assertions here go RED
// until abi-codegen's bundled schema AND these canonical lists are updated too.

const __dirname = dirname(fileURLToPath(import.meta.url));

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

const bundled = JSON.parse(
  readFileSync(join(__dirname, '../src/schema/wasm-abi-v1.schema.json'), 'utf-8'),
);
const vendoredCore = JSON.parse(
  readFileSync(
    join(__dirname, '../__fixtures__/corpus/wasm-abi.schema.json'),
    'utf-8',
  ),
);

function enumAt(schema: any, path: string[]): string[] {
  let node = schema;
  for (const key of path) {
    expect(node, `schema path missing: ${path.join('.')}`).toHaveProperty(key);
    node = node[key];
  }
  expect(Array.isArray(node), `schema path is not an array: ${path.join('.')}`).toBe(
    true,
  );
  return [...node].sort();
}

const sorted = (xs: string[]) => [...xs].sort();
const CRDT_PATH = ['definitions', 'CrdtType', 'enum'];
const INTENT_PATH = ['definitions', 'Method', 'properties', 'intent', 'enum'];

describe('Enum completeness (CrdtType + Method.intent mirror core)', () => {
  it("bundled CrdtType enum equals core's CrdtCollectionType", () => {
    expect(enumAt(bundled, CRDT_PATH)).toEqual(sorted(CANONICAL_CRDT_TYPES));
  });

  it("vendored core CrdtType enum equals CrdtCollectionType", () => {
    expect(enumAt(vendoredCore, CRDT_PATH)).toEqual(
      sorted(CANONICAL_CRDT_TYPES),
    );
  });

  it("bundled Method.intent enum equals core's MethodIntent", () => {
    expect(enumAt(bundled, INTENT_PATH)).toEqual(
      sorted(CANONICAL_METHOD_INTENTS),
    );
  });

  it('vendored core Method.intent enum equals MethodIntent', () => {
    expect(enumAt(vendoredCore, INTENT_PATH)).toEqual(
      sorted(CANONICAL_METHOD_INTENTS),
    );
  });

  it('bundled and core enums agree with each other', () => {
    expect(enumAt(bundled, CRDT_PATH)).toEqual(enumAt(vendoredCore, CRDT_PATH));
    expect(enumAt(bundled, INTENT_PATH)).toEqual(
      enumAt(vendoredCore, INTENT_PATH),
    );
  });
});
