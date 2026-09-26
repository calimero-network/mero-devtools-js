import { describe, it, expect } from 'vitest';
import { parseAbiManifest } from '../src/parse.js';

// One doc-bearing instance of every object kind that carries `doc`.
const documented = (): any => ({
  schema_version: 'wasm-abi/1',
  types: {
    Entry: {
      kind: 'record',
      doc: 'A stored entry.',
      fields: [{ name: 'key', type: { kind: 'string' }, doc: 'Lookup key.' }],
    },
    Status: {
      kind: 'variant',
      doc: 'Entry lifecycle.',
      variants: [{ name: 'Live', doc: 'Visible to readers.' }],
    },
    EntryId: {
      kind: 'alias',
      target: { kind: 'string' },
      doc: 'Opaque entry id.',
    },
    Digest: { kind: 'bytes', size: 32, doc: 'SHA-256 of the value.' },
  },
  methods: [
    {
      name: 'set',
      doc: 'Store a value.\n\n# Errors\nFails when the key is empty.',
      params: [
        { name: 'key', type: { kind: 'string' }, doc: 'Lookup key.' },
        { name: 'value', type: { kind: 'string' } },
      ],
    },
    {
      name: 'remove',
      params: [],
      returns: { kind: 'bool' },
      returns_doc: 'Whether the key existed.',
      destructive: true,
      idempotent: true,
    },
    { name: 'plain', params: [] },
  ],
  events: [{ name: 'Stored', doc: 'Emitted after set.' }],
});

describe('doc fields', () => {
  it('parses a doc on every object kind and exposes it', () => {
    const m = parseAbiManifest(documented());
    expect(m.types.Entry.doc).toBe('A stored entry.');
    expect(m.types.Status.doc).toBe('Entry lifecycle.');
    expect(m.types.EntryId.doc).toBe('Opaque entry id.');
    expect(m.types.Digest.doc).toBe('SHA-256 of the value.');
    const entry = m.types.Entry;
    expect(entry.kind === 'record' && entry.fields[0].doc).toBe('Lookup key.');
    const status = m.types.Status;
    expect(status.kind === 'variant' && status.variants[0].doc).toBe(
      'Visible to readers.',
    );
    expect(m.methods[0].doc).toBe(
      'Store a value.\n\n# Errors\nFails when the key is empty.',
    );
    expect(m.methods[0].params[0].doc).toBe('Lookup key.');
    expect(m.events[0].doc).toBe('Emitted after set.');
  });

  it('parses returns_doc, destructive and idempotent on a method', () => {
    const remove = parseAbiManifest(documented()).methods[1];
    expect(remove.returns_doc).toBe('Whether the key existed.');
    expect(remove.destructive).toBe(true);
    expect(remove.idempotent).toBe(true);
  });

  it('freezes doc-bearing objects like the rest of the manifest', () => {
    const m = parseAbiManifest(documented());
    expect(Object.isFrozen(m.methods[0].params[0])).toBe(true);
    expect(Object.isFrozen(m.types.Entry)).toBe(true);
  });

  it('still rejects an unknown key next to doc', () => {
    const bad = documented();
    bad.methods[0].docs = 'typo';
    expect(() => parseAbiManifest(bad)).toThrow(/ABI schema validation failed/);
  });

  it('rejects doc on an error entry', () => {
    const bad = documented();
    bad.methods[0].errors = [{ code: 'EMPTY_KEY', doc: 'not an ABI field' }];
    expect(() => parseAbiManifest(bad)).toThrow(/ABI schema validation failed/);
  });

  it('rejects doc on an inline record type', () => {
    const bad = documented();
    bad.methods[0].params[1].type = { kind: 'record', fields: [], doc: 'x' };
    expect(() => parseAbiManifest(bad)).toThrow(/ABI schema validation failed/);
  });

  it('rejects doc on an inline bytes type', () => {
    const bad = documented();
    bad.methods[0].params[1].type = { kind: 'bytes', size: 4, doc: 'x' };
    expect(() => parseAbiManifest(bad)).toThrow(/ABI schema validation failed/);
  });

  it('rejects a non-string doc and a non-boolean method flag', () => {
    const badDoc = documented();
    badDoc.events[0].doc = 42;
    expect(() => parseAbiManifest(badDoc)).toThrow(
      /ABI schema validation failed/,
    );
    const badFlag = documented();
    badFlag.methods[1].destructive = 'yes';
    expect(() => parseAbiManifest(badFlag)).toThrow(
      /ABI schema validation failed/,
    );
  });
});
