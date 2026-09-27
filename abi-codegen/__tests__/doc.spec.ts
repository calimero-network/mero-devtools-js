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
    Action: {
      kind: 'variant',
      doc: 'Something happened.',
      variants: [
        { name: 'Ping', payload: { kind: 'string' }, doc: 'Carries a note.' },
        { name: 'Stop', doc: 'Ends the session.' },
      ],
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
  events: [
    { name: 'Stored', doc: 'Emitted after set.' },
    { name: 'Noted', payload: { kind: 'string' }, doc: 'A note was added.' },
  ],
});

describe('doc fields', () => {
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

  it('escapes a comment terminator on a method, a field and a type', () => {
    const m = documented();
    m.methods[0].doc = 'Globs like a/*/b are literal.';
    m.types.Entry.doc = 'A record, e.g. a/*/b.';
    m.types.Entry.fields[0].doc = 'A key, e.g. a/*/b.';
    const escaped = generateClient(parseAbiManifest(m), 'DocClient');
    expect(escaped).toContain('   * Globs like a/*\\/b are literal.');
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

  it('splits a doc on CRLF and on a lone CR', () => {
    const m = documented();
    m.methods[0].doc = 'a\r\nb\rc';
    const rendered = generateClient(parseAbiManifest(m), 'DocClient');
    expect(rendered).toContain('   * a\n   * b\n   * c\n');
    expect(rendered).not.toContain('\r');
  });

  it('puts the type doc on the factory for a payload-bearing variant', () => {
    expect(out).toContain(
      '/**\n * Something happened.\n */\nexport const Action = {',
    );
    expect(out).not.toContain(
      '/**\n * Something happened.\n */\nexport type ActionPayload =',
    );
  });

  it('puts a variant member doc above its factory function', () => {
    expect(out).toContain('  /**\n   * Carries a note.\n   */\n  Ping: (');
    expect(out).toContain('  /**\n   * Ends the session.\n   */\n  Stop: (');
  });

  // A unit-only variant is a string-literal union: no member declaration exists
  // for a doc to attach to, so tooling could never surface it.
  it('emits no member doc for a unit-only variant', () => {
    expect(out).not.toContain('Visible to readers.');
  });

  it('puts an event doc on the name property of its AbiEvent member', () => {
    expect(out).toContain(
      '  | {\n    /**\n     * Emitted after set.\n     */\n    name: "Stored";\n  }',
    );
    expect(out).toContain(
      '  | {\n    /**\n     * A note was added.\n     */\n    name: "Noted";\n    payload: string;\n  }',
    );
  });
});
