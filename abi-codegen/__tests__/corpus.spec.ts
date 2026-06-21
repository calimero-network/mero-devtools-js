import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { parseAbiManifest } from '../src/parse.js';
import { generateClient } from '../src/generate/client.js';
import { deriveClientNameFromPath } from '../src/generate/emit.js';

// Cross-repo guard: parse every real ABI emitted by calimero core (every
// core/apps/*/res/abi.json + the conformance app's expected manifest) and
// mero-drive through abi-codegen's actual parse path. This is the test that
// catches core drifting ahead of the bundled schema — the exact failure that
// silently shipped before. The corpus is a vendored snapshot under
// __fixtures__/corpus/ (regenerate with `node scripts/sync-corpus.mjs`).

const __dirname = dirname(fileURLToPath(import.meta.url));
const corpusDir = join(__dirname, '../__fixtures__/corpus');
const abisDir = join(corpusDir, 'abis');

const sources = JSON.parse(
  readFileSync(join(corpusDir, 'SOURCES.json'), 'utf-8'),
);
const abiFiles = readdirSync(abisDir)
  .filter((f) => f.endsWith('.json'))
  .sort();

// Tiering: the full ~20-manifest corpus is exhaustive but slow to iterate. CI
// (and an opt-in env) runs the whole thing on every PR; local `pnpm test` runs a
// fast smoke against the single richest manifest — the conformance app's ABI,
// which exercises the broadest method/type/event surface. The corpus stays
// vendored either way; this only changes how many fixtures are walked locally.
const FULL_CORPUS = !!process.env.CI || !!process.env.ABI_FULL_CORPUS;
const SMOKE_FIXTURE = 'core-abi_conformance-expected.json';
const corpusFiles = FULL_CORPUS
  ? abiFiles
  : abiFiles.includes(SMOKE_FIXTURE)
    ? [SMOKE_FIXTURE]
    : abiFiles.slice(0, 1);

describe('Real-ABI corpus (cross-repo with core)', () => {
  // Full-corpus-only: snapshot integrity and the all-11-CRDT proof need the
  // whole vendored set, so they run in CI (and on opt-in), not in the local smoke.
  it.runIf(FULL_CORPUS)(
    'vendored snapshot is present and matches SOURCES.json',
    () => {
      // A zero/short corpus would make the parse loop vacuously pass — guard it.
      expect(abiFiles.length).toBeGreaterThanOrEqual(20);
      expect(abiFiles.length).toBe(sources.abis.length);
      const recorded = sources.abis.map((a: { name: string }) => a.name).sort();
      expect(abiFiles).toEqual(recorded);
    },
  );

  it.each(corpusFiles)('parses %s through the real parse path', (file) => {
    const json = JSON.parse(readFileSync(join(abisDir, file), 'utf-8'));
    const manifest = parseAbiManifest(json);
    expect(manifest.schema_version).toBe('wasm-abi/1');
    expect(manifest.methods).toBeInstanceOf(Array);
  });

  it.each(corpusFiles)(
    'generates a non-empty client with every method present from %s',
    (file) => {
      const json = JSON.parse(readFileSync(join(abisDir, file), 'utf-8'));
      const manifest = parseAbiManifest(json);
      const clientName = deriveClientNameFromPath(file);
      const client = generateClient(manifest, clientName);

      // Non-empty output with the class shell — an empty dir is a failure.
      expect(client.length).toBeGreaterThan(0);
      expect(client).toContain(`export class ${clientName} {`);

      // Every ABI method must surface verbatim in an rpc.execute call.
      for (const method of manifest.methods) {
        expect(client).toContain(`method: '${method.name}'`);
      }
    },
  );

  it.runIf(FULL_CORPUS)(
    'exercises all 11 CRDT collection types across the corpus',
    () => {
      // Proves the widened CrdtType enum is actually required by real ABIs, not
      // just permitted — every value below appears somewhere in the corpus.
      const seen = new Set<string>();
      const walk = (node: unknown): void => {
        if (!node || typeof node !== 'object') return;
        const obj = node as Record<string, unknown>;
        if (typeof obj.crdt_type === 'string') seen.add(obj.crdt_type);
        for (const value of Object.values(obj)) {
          if (Array.isArray(value)) value.forEach(walk);
          else if (value && typeof value === 'object') walk(value);
        }
      };
      for (const file of abiFiles) {
        walk(JSON.parse(readFileSync(join(abisDir, file), 'utf-8')));
      }
      expect([...seen].sort()).toEqual(
        [
          'authored_map',
          'authored_vector',
          'counter',
          'lww_register',
          'replicated_growable_array',
          'shared_storage',
          'sorted_map',
          'sorted_set',
          'unordered_map',
          'unordered_set',
          'vector',
        ].sort(),
      );
    },
  );
});
