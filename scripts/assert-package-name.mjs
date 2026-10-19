#!/usr/bin/env node
/**
 * Refuse to publish under a name this repo does not own.
 *
 * `npm publish` ships whatever `name` says. Rename a package and the release
 * does not fail — it quietly creates a NEW package on npm and keeps publishing
 * the real one from the next commit onwards, leaving a ghost behind that nobody
 * maintains and nobody notices.
 *
 * That already happened here. In January `create-mero-app` was renamed to
 * `@calimero-network/create-mero-app` (bc7d026), released once as 0.1.0, and
 * renamed back a few commits later (f8b42f4). The scoped package is still on
 * npm, still on 0.1.0, still cloning a repo that has since been archived, and
 * still serving ~18 downloads a month — none of which get any fix made since.
 *
 * Run from the package directory, with the expected published name:
 *
 *   node ../scripts/assert-package-name.mjs create-mero-app
 */

import { readFileSync } from 'node:fs';

const expected = process.argv[2];
if (!expected) {
  console.error('usage: assert-package-name.mjs <expected-package-name>');
  process.exit(1);
}

const { name: actual } = JSON.parse(readFileSync('./package.json', 'utf8'));

if (actual !== expected) {
  console.error(
    [
      `✖ refusing to publish: package.json name is "${actual}", expected "${expected}".`,
      '',
      '  Publishing now would create a NEW package on npm rather than a new',
      '  version of the existing one, and leave whoever installs the old name',
      '  on a build that never receives another fix.',
      '',
      '  If the rename is deliberate, update the expected name in this package',
      `  .releaserc.json, and deprecate "${expected}" on npm so its users are`,
      '  pointed at the new one:',
      '',
      `    npm deprecate ${expected} "renamed to ${actual}"`,
    ].join('\n'),
  );
  process.exit(1);
}

console.log(`✓ publishing as ${actual}`);
