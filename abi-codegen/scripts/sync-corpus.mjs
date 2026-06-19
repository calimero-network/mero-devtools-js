#!/usr/bin/env node
// Sync the cross-repo ABI corpus and the upstream JSON Schema from calimero core
// (and mero-drive) into a committed snapshot under __fixtures__/corpus/.
//
// The snapshot is what CI parses — vendoring keeps the cross-repo guard
// deterministic and checkout-free. Re-run this whenever core's ABIs or schema
// change, then commit the result:
//
//   node scripts/sync-corpus.mjs
//
// Source repos are resolved relative to this package, override with env vars:
//   CALIMERO_CORE_DIR        (default: ../../core)
//   CALIMERO_MERO_DRIVE_DIR  (default: ../../mero-drive)

import { createHash } from 'crypto';
import {
  readFileSync,
  writeFileSync,
  readdirSync,
  existsSync,
  rmSync,
  mkdirSync,
} from 'fs';
import { dirname, join, relative, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(__dirname, '..');

const coreDir = resolve(
  process.env.CALIMERO_CORE_DIR || join(pkgRoot, '..', '..', 'core'),
);
const meroDriveDir = resolve(
  process.env.CALIMERO_MERO_DRIVE_DIR ||
    join(pkgRoot, '..', '..', 'mero-drive'),
);

const corpusDir = join(pkgRoot, '__fixtures__', 'corpus');
const abisDir = join(corpusDir, 'abis');

function fail(msg) {
  console.error(`✖ ${msg}`);
  process.exit(1);
}

if (!existsSync(coreDir)) {
  fail(
    `core repo not found at ${coreDir}. Set CALIMERO_CORE_DIR to its location.`,
  );
}
if (!existsSync(meroDriveDir)) {
  fail(
    `mero-drive repo not found at ${meroDriveDir}. Set CALIMERO_MERO_DRIVE_DIR to its location.`,
  );
}

// Build the list of vendored entries. `repo` + `src` yield a stable,
// machine-independent provenance path in SOURCES.json.
const entries = [];

// Every core app's emitted ABI.
const appsDir = join(coreDir, 'apps');
for (const app of readdirSync(appsDir).sort()) {
  const src = join(appsDir, app, 'res', 'abi.json');
  if (existsSync(src)) {
    entries.push({ name: `core-apps-${app}.json`, repo: 'core', base: coreDir, src });
  }
}

// The conformance app's checked-in expected ABI (the richest single manifest).
const conformanceExpected = join(
  coreDir,
  'apps',
  'abi_conformance',
  'abi.expected.json',
);
if (existsSync(conformanceExpected)) {
  entries.push({
    name: 'core-abi_conformance-expected.json',
    repo: 'core',
    base: coreDir,
    src: conformanceExpected,
  });
}

// mero-drive's two real consumer ABIs.
for (const crate of ['docs', 'registry']) {
  const src = join(meroDriveDir, 'logic', 'crates', crate, 'res', 'abi.json');
  if (existsSync(src)) {
    entries.push({
      name: `mero-drive-${crate}.json`,
      repo: 'mero-drive',
      base: meroDriveDir,
      src,
    });
  }
}

if (entries.length === 0) {
  fail('no ABI files found — check the source repo paths.');
}

const schemaSrc = join(coreDir, 'crates', 'wasm-abi', 'wasm-abi.schema.json');
if (!existsSync(schemaSrc)) {
  fail(`core schema not found at ${schemaSrc}.`);
}

const sha = (buf) => createHash('sha256').update(buf).digest('hex');

// Rewrite the snapshot from scratch so deletions upstream propagate.
rmSync(corpusDir, { recursive: true, force: true });
mkdirSync(abisDir, { recursive: true });

const abis = [];
for (const { name, repo, base, src } of entries) {
  const buf = readFileSync(src);
  JSON.parse(buf); // fail loudly on malformed source JSON
  writeFileSync(join(abisDir, name), buf);
  abis.push({
    name,
    source: `${repo}/${relative(base, src)}`,
    sha256: sha(buf),
  });
}

const schemaBuf = readFileSync(schemaSrc);
JSON.parse(schemaBuf);
writeFileSync(join(corpusDir, 'wasm-abi.schema.json'), schemaBuf);

const sources = {
  description:
    'Vendored snapshot of the calimero core ABI corpus and JSON Schema. ' +
    'Regenerate with `node scripts/sync-corpus.mjs`; do not hand-edit.',
  abis,
  schema: {
    name: 'wasm-abi.schema.json',
    source: `core/${relative(coreDir, schemaSrc)}`,
    sha256: sha(schemaBuf),
  },
};
writeFileSync(
  join(corpusDir, 'SOURCES.json'),
  JSON.stringify(sources, null, 2) + '\n',
);

console.log(
  `✓ synced ${abis.length} ABIs + schema into __fixtures__/corpus/`,
);
