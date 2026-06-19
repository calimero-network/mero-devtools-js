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

describe('Real-ABI corpus (cross-repo with core)', () => {
  it('vendored snapshot is present and matches SOURCES.json', () => {
    // A zero/short corpus would make the parse loop vacuously pass — guard it.
    expect(abiFiles.length).toBeGreaterThanOrEqual(20);
    expect(abiFiles.length).toBe(sources.abis.length);
    const recorded = sources.abis.map((a: { name: string }) => a.name).sort();
    expect(abiFiles).toEqual(recorded);
  });

  it.each(abiFiles)('parses %s through the real parse path', (file) => {
    const json = JSON.parse(readFileSync(join(abisDir, file), 'utf-8'));
    const manifest = parseAbiManifest(json);
    expect(manifest.schema_version).toBe('wasm-abi/1');
    expect(manifest.methods).toBeInstanceOf(Array);
  });

  it.each(abiFiles)(
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

  it('exercises all 11 CRDT collection types across the corpus', () => {
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
  });
});
