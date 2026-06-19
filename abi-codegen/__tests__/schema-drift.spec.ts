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

// JSON-pointer paths where abi-codegen and core intentionally differ. Anything
// outside this set is real drift and fails the test.
const KNOWN_DEVIATIONS: { path: string; reason: string }[] = [
  {
    path: '/definitions/CollectionType/oneOf/3',
    reason:
      'abi-codegen extension: a `tuple` collection branch. Core rejects tuples ' +
      'during normalization so never emits one; the extra branch only widens ' +
      'what abi-codegen accepts and cannot reject a valid core ABI.',
  },
  {
    path: '/definitions/TypeDef/oneOf/4',
    reason:
      "core-only dangling $ref to #/definitions/VariableBytesType, which core's " +
      'schema never defines and whose Rust enum has no counterpart. Variable ' +
      'bytes are already covered by the BytesType branch (optional size). AJV ' +
      'would fail to compile the missing ref, so abi-codegen omits the branch.',
  },
];

const STRIP_KEYS = new Set(['description', 'title', '$comment']);

// Drop human-facing annotations and impose a stable order on order-insensitive
// arrays so only structural/semantic differences survive.
function normalize(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(normalize);
  if (node && typeof node === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node)) {
      if (STRIP_KEYS.has(key)) continue;
      out[key] = normalize(value);
    }
    if (Array.isArray(out.enum)) out.enum = [...out.enum].sort();
    if (Array.isArray(out.required)) out.required = [...out.required].sort();
    return out;
  }
  return node;
}

function eq(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

// Recursive structural diff producing granular JSON-pointer paths.
function diffPaths(a: any, b: any, path: string, out: string[]): void {
  if (eq(a, b)) return;
  if (
    a === undefined ||
    b === undefined ||
    a === null ||
    b === null ||
    typeof a !== typeof b ||
    typeof a !== 'object'
  ) {
    out.push(path);
    return;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) {
      out.push(path);
      return;
    }
    const n = Math.max(a.length, b.length);
    for (let i = 0; i < n; i++) {
      if (i >= a.length || i >= b.length) out.push(`${path}/${i}`);
      else diffPaths(a[i], b[i], `${path}/${i}`, out);
    }
    return;
  }
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if (!(key in a) || !(key in b)) out.push(`${path}/${key}`);
    else diffPaths(a[key], b[key], `${path}/${key}`, out);
  }
}

describe('Schema drift check (abi-codegen vs core)', () => {
  const bundled = normalize(
    JSON.parse(readFileSync(bundledSchemaPath, 'utf-8')),
  );
  const vendoredCore = normalize(
    JSON.parse(readFileSync(vendoredCoreSchemaPath, 'utf-8')),
  );

  it('diverges from core only in the documented, intentional ways', () => {
    const allowed = new Set(KNOWN_DEVIATIONS.map((d) => d.path));
    const paths: string[] = [];
    diffPaths(bundled, vendoredCore, '', paths);

    const unexpected = paths.filter((p) => !allowed.has(p));
    expect(
      unexpected,
      'Bundled schema has drifted from core/crates/wasm-abi/wasm-abi.schema.json. ' +
        'Update src/schema/wasm-abi-v1.schema.json to match (and re-run ' +
        '`node scripts/sync-corpus.mjs`), or add a documented entry to ' +
        `KNOWN_DEVIATIONS. Unexpected paths: ${JSON.stringify(unexpected)}`,
    ).toEqual([]);
  });

  // When a core checkout is available locally, prove the vendored snapshot is
  // not stale — i.e. someone changed core without re-running the sync script.
  // CI runs without core checked out and skips this leg (the vendored snapshot
  // is the deterministic baseline there).
  const coreDir = resolve(
    process.env.CALIMERO_CORE_DIR || join(__dirname, '../../../core'),
  );
  const liveCoreSchema = join(
    coreDir,
    'crates/wasm-abi/wasm-abi.schema.json',
  );
  const haveLiveCore = existsSync(liveCoreSchema);

  it.runIf(haveLiveCore)(
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
