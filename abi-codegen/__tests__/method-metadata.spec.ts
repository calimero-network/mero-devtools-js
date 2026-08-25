import { describe, it, expect } from 'vitest';
import { parseAbiManifest } from '../src/parse.js';
import { generateClient } from '../src/generate/client.js';

// The node enforces both of these at call time (core: xcall caller policy, and
// migrate entrypoints driven by the upgrade path). Nothing about them is
// visible in the emitted signature, so without a doc tag a caller finds out at
// runtime.
const manifest = parseAbiManifest({
  schema_version: 'wasm-abi/1',
  types: {},
  methods: [
    { name: 'open_call', params: [], xcall_callable: true, xcall_callers: 'any_in_namespace' },
    { name: 'closed_call', params: [], xcall_callable: true, xcall_callers: 'same_app' },
    { name: 'defaulted_call', params: [], xcall_callable: true },
    { name: 'plain_call', params: [] },
    { name: 'migrate_v1', params: [], intent: 'mutating' },
  ],
  events: [],
  state_version: 2,
  migrations: [{ method: 'migrate_v1', fromVersion: 1 }],
});

describe('method metadata in JSDoc', () => {
  const out = generateClient(manifest, 'MetaClient');

  it('marks xcall entry points with their caller policy', () => {
    expect(out).toContain('@xcall any_in_namespace');
    expect(out).toContain('@xcall same_app');
  });

  it('defaults an xcall method with no declared policy to any_in_namespace', () => {
    const block = out.slice(0, out.indexOf('public async defaultedCall'));
    expect(block.slice(block.lastIndexOf('/**'))).toContain('@xcall any_in_namespace');
  });

  it('leaves a non-xcall method unmarked', () => {
    const block = out.slice(0, out.indexOf('public async plainCall'));
    expect(block.slice(block.lastIndexOf('/**'))).not.toContain('@xcall');
  });

  it('marks a declared migration entrypoint with the version it carries from', () => {
    expect(out).toContain('@migration from state version 1');
  });

  it('leaves a method that is not a migration entrypoint unmarked', () => {
    const block = out.slice(0, out.indexOf('public async plainCall'));
    expect(block.slice(block.lastIndexOf('/**'))).not.toContain('@migration');
  });
});
