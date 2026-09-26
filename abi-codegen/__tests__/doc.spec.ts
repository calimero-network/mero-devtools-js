import { describe, it, expect } from 'vitest';
import { parseAbiManifest } from '../src/parse.js';
import { generateClient } from '../src/generate/client.js';

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

describe('doc emission as JSDoc', () => {
  const out = generateClient(parseAbiManifest(documented()), 'DocClient');

  it('puts a named type doc above each declaration kind', () => {
    expect(out).toContain(
      '/**\n * A stored entry.\n */\nexport interface Entry {',
    );
    expect(out).toContain(
      '/**\n * Entry lifecycle.\n */\nexport type Status =',
    );
    expect(out).toContain(
      '/**\n * Opaque entry id.\n */\nexport type EntryId =',
    );
  });

  it('emits no orphan comment for a named bytes type, which declares nothing', () => {
    expect(out).not.toContain('SHA-256 of the value.');
  });

  it('puts a field doc above the field', () => {
    expect(out).toContain('  /**\n   * Lookup key.\n   */\n  key: string;');
  });

  it('renders the method doc and documented params in the method JSDoc', () => {
    expect(out).toContain(
      [
        '  /**',
        '   * set',
        '   *',
        '   * Store a value.',
        '   *',
        '   * # Errors',
        '   * Fails when the key is empty.',
        '   *',
        '   * @param params.key Lookup key.',
        '   */',
        '  public async set(',
      ].join('\n'),
    );
  });

  it('renders returns_doc and the method flags as tags', () => {
    expect(out).toContain(
      [
        '  /**',
        '   * remove',
        '   *',
        '   * @returns Whether the key existed.',
        '   * @remarks destructive, idempotent',
        '   */',
        '  public async remove(',
      ].join('\n'),
    );
  });

  it('adds no @param line for an undocumented param', () => {
    expect(out).not.toContain('@param params.value');
  });

  it('leaves an undocumented method block unchanged', () => {
    expect(out).toContain('  /**\n   * plain\n   */\n  public async plain(');
  });

  it('escapes a comment terminator in doc text', () => {
    const m = documented();
    m.methods[0].doc = 'Globs like a/*/b are literal.';
    const escaped = generateClient(parseAbiManifest(m), 'DocClient');
    expect(escaped).toContain('   * Globs like a/*\\/b are literal.');
    expect(escaped).not.toContain('a/*/b');
  });

  it('escapes a comment terminator on a field and on a type definition', () => {
    const m = documented();
    m.types.Entry.doc = 'A record, e.g. a/*/b.';
    m.types.Entry.fields[0].doc = 'A key, e.g. a/*/b.';
    const escaped = generateClient(parseAbiManifest(m), 'DocClient');
    expect(escaped).toContain('A record, e.g. a/*\\/b.');
    expect(escaped).toContain('A key, e.g. a/*\\/b.');
    expect(escaped).not.toContain('a/*/b');
  });

  it('renders a multi-line param doc inside its @param tag', () => {
    const m = documented();
    m.methods[0].params[0].doc = 'Lookup key.\nMust be non-empty.';
    const rendered = generateClient(parseAbiManifest(m), 'DocClient');
    expect(rendered).toContain(
      '   * @param params.key Lookup key.\n   * Must be non-empty.',
    );
  });

  it('drops carriage returns from method doc with CRLF line endings', () => {
    const m = documented();
    m.methods[0].doc = 'line one\r\nline two';
    const rendered = generateClient(parseAbiManifest(m), 'DocClient');
    expect(rendered).toContain('   * line one\n   * line two');
    expect(rendered).not.toContain('\r');
  });
});
