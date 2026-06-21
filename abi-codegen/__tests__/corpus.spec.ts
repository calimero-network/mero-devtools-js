import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { parseAbiManifest } from '../src/parse.js';
import { generateClient } from '../src/generate/client.js';
import { deriveClientNameFromPath } from '../src/generate/emit.js';

// End-to-end guard on one REAL core ABI: the conformance app's manifest (the
// richest single manifest core emits) must parse through the actual parse path
// and generate a non-empty client with every method. This catches model/codegen
// bugs that a pure schema comparison would miss.
//
// Scope is deliberately narrow. SCHEMA PARITY with core (the drift that caused
// the original breakage) is covered by schema-drift.spec.ts and
// enum-completeness.spec.ts against the vendored core schema. The full multi-app
// breadth and the "all 11 CRDT types are exercised" check are a CORE emitter
// concern, proven live in calimero core (PR #2839 builds every app, extracts its
// ABI, and validates it against this tool) — so they are intentionally not
// duplicated here as a large vendored corpus.

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = 'core-abi_conformance-expected.json';
const fixturePath = join(__dirname, '../__fixtures__/corpus/abis', FIXTURE);

describe('Real-ABI end-to-end (core conformance manifest)', () => {
  it('parses through the real parse path', () => {
    const json = JSON.parse(readFileSync(fixturePath, 'utf-8'));
    const manifest = parseAbiManifest(json);
    expect(manifest.schema_version).toBe('wasm-abi/1');
    expect(manifest.methods.length).toBeGreaterThan(0);
  });

  it('generates a non-empty client with every method present', () => {
    const json = JSON.parse(readFileSync(fixturePath, 'utf-8'));
    const manifest = parseAbiManifest(json);
    const clientName = deriveClientNameFromPath(FIXTURE);
    const client = generateClient(manifest, clientName);

    // Non-empty output with the class shell — an empty client is a failure.
    expect(client.length).toBeGreaterThan(0);
    expect(client).toContain(`export class ${clientName} {`);

    // Every ABI method must surface verbatim in an rpc.execute call.
    for (const method of manifest.methods) {
      expect(client).toContain(`method: '${method.name}'`);
    }
  });
});
