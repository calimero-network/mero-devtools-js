#!/usr/bin/env node
// Sync the two cross-repo reference files from calimero core into the committed
// snapshot under __fixtures__/corpus/:
//
//   • wasm-abi.schema.json                  — core's JSON Schema (the schema-parity
//                                             reference for schema-drift / enum tests)
//   • abis/core-abi_conformance-expected.json — core's richest real ABI (the one
//                                             real-manifest end-to-end sample)
//
// Both are CHECKED-IN files in core, so this needs no core build and no other
// repos — it works against a plain checkout or a release-tag checkout. The full
// multi-app breadth and the "all 11 CRDT types are exercised" guarantee live on
// the core side (core builds every app and validates its ABI against this tool),
// so they are deliberately not vendored here.
//
// Re-run whenever core's schema or conformance ABI changes, then commit:
//
//   node scripts/sync-corpus.mjs
//
// Core is resolved relative to this package; override with CALIMERO_CORE_DIR
// (e.g. point it at a checkout of the latest core release tag).

import { createHash } from 'crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname, join, relative, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(__dirname, '..');

const coreDir = resolve(
  process.env.CALIMERO_CORE_DIR || join(pkgRoot, '..', '..', 'core'),
);

const corpusDir = join(pkgRoot, '__fixtures__', 'corpus');
const abisDir = join(corpusDir, 'abis');

function fail(msg) {
  console.error(`✖ ${msg}`);
  process.exit(1);
}

if (!existsSync(coreDir)) {
  fail(
    `core repo not found at ${coreDir}. Set CALIMERO_CORE_DIR to its location ` +
      `(e.g. a checkout of the latest core release tag).`,
  );
}

const sha = (buf) => createHash('sha256').update(buf).digest('hex');

// Validate sources are readable BEFORE touching the vendored snapshot, so a
// partial/missing checkout can't leave the corpus half-written.
const schemaSrc = join(coreDir, 'crates', 'wasm-abi', 'wasm-abi.schema.json');
const conformanceSrc = join(
  coreDir,
  'apps',
  'abi_conformance',
  'abi.expected.json',
);
for (const [label, src] of [
  ['schema', schemaSrc],
  ['conformance ABI', conformanceSrc],
]) {
  if (!existsSync(src)) fail(`core ${label} not found at ${src}.`);
}

const schemaBuf = readFileSync(schemaSrc);
const conformanceBuf = readFileSync(conformanceSrc);
JSON.parse(schemaBuf); // fail loudly on malformed source JSON
JSON.parse(conformanceBuf);

mkdirSync(abisDir, { recursive: true });
writeFileSync(join(corpusDir, 'wasm-abi.schema.json'), schemaBuf);
writeFileSync(
  join(abisDir, 'core-abi_conformance-expected.json'),
  conformanceBuf,
);
// Keep the PRIMARY fixture (used by validate:abi, generate:example, and the unit
// specs) in lockstep with the corpus copy — they are the same core manifest, so
// syncing one without the other would let them silently diverge.
writeFileSync(
  join(pkgRoot, '__fixtures__', 'abi_conformance.json'),
  conformanceBuf,
);

const sources = {
  description:
    'Vendored reference files from calimero core (checked-in sources, no build). ' +
    'Regenerate with `node scripts/sync-corpus.mjs`; do not hand-edit.',
  schema: {
    name: 'wasm-abi.schema.json',
    source: `core/${relative(coreDir, schemaSrc)}`,
    sha256: sha(schemaBuf),
  },
  abis: [
    {
      name: 'core-abi_conformance-expected.json',
      source: `core/${relative(coreDir, conformanceSrc)}`,
      sha256: sha(conformanceBuf),
    },
  ],
};
writeFileSync(
  join(corpusDir, 'SOURCES.json'),
  JSON.stringify(sources, null, 2) + '\n',
);

console.log(
  '✓ synced wasm-abi.schema.json + conformance ABI into __fixtures__/corpus/',
);
