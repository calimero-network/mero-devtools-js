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
// Read + JSON-validate a source file, failing with the file path in the message
// if it is missing or malformed — and BEFORE any write, so a bad source can't
// leave the vendored snapshot half-written.
function readJsonChecked(src, label) {
  if (!existsSync(src)) fail(`core ${label} not found at ${src}.`);
  const buf = readFileSync(src);
  try {
    JSON.parse(buf);
  } catch (err) {
    fail(`core ${label} at ${src} is not valid JSON: ${err.message}`);
  }
  return buf;
}

const schemaBuf = readJsonChecked(schemaSrc, 'schema');
const conformanceBuf = readJsonChecked(conformanceSrc, 'conformance ABI');

// Write a vendored file, loudly noting when the new content differs from what is
// already committed — so an accidental change (local edits to the fixture, or a
// CALIMERO_CORE_DIR pointed at a stale/older tag) is visible, not silent.
function writeVendored(dest, buf) {
  const rel = relative(pkgRoot, dest);
  if (existsSync(dest) && !readFileSync(dest).equals(buf)) {
    console.warn(`⚠ ${rel} changed vs the committed copy — overwriting`);
  }
  writeFileSync(dest, buf);
}

mkdirSync(abisDir, { recursive: true });
writeVendored(join(corpusDir, 'wasm-abi.schema.json'), schemaBuf);
writeVendored(
  join(abisDir, 'core-abi_conformance-expected.json'),
  conformanceBuf,
);
// Keep the PRIMARY fixture (used by validate:abi, generate:example, and the unit
// specs) in lockstep with the corpus copy — they are the same core manifest, so
// syncing one without the other would let them silently diverge.
writeVendored(
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
