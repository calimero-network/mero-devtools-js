import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { parseAbiManifest } from '../src/parse.js';
import { generateClient } from '../src/generate/client.js';
import { mockMeroImport, typecheckGeneratedClient } from './tsc.js';

// A name that closes a literal or a comment and then runs code.
const PAYLOAD = `'; globalThis.__injected = 1; //`;
const METHOD = `run(){}static{globalThis.__injected = 1}async[0]`;
const PARAM = `x: number }); globalThis.__injected = 1; ({`;
const VARIANT = `Off${PAYLOAD}`;
const EVENT = `Ping"; globalThis.__injected = 1; //`;
const ERROR = `Bad */ globalThis.__injected = 1; /*`;

const base = () => ({
  schema_version: 'wasm-abi/1',
  types: {} as Record<string, unknown>,
  methods: [{ name: 'noop', params: [] }],
  events: [] as unknown[],
});

describe('hostile names are refused', () => {
  const cases: Array<[string, string, () => unknown]> = [
    [
      'method',
      METHOD,
      () => ({ ...base(), methods: [{ name: METHOD, params: [] }] }),
    ],
    [
      'parameter',
      PARAM,
      () => ({
        ...base(),
        methods: [
          {
            name: 'noop',
            params: [{ name: PARAM, type: { kind: 'string' } }],
          },
        ],
      }),
    ],
    [
      'variant',
      VARIANT,
      () => ({
        ...base(),
        types: {
          Mode: {
            kind: 'variant',
            variants: [{ name: 'On' }, { name: VARIANT }],
          },
        },
      }),
    ],
    ['event', EVENT, () => ({ ...base(), events: [{ name: EVENT }] })],
    [
      'error code',
      ERROR,
      () => ({
        ...base(),
        methods: [{ name: 'noop', params: [], errors: [{ code: ERROR }] }],
      }),
    ],
  ];

  it.each(cases)('%s', (what, name, make) => {
    expect(() => parseAbiManifest(make())).toThrow(
      `Invalid ${what} name ${JSON.stringify(name)}`,
    );
  });

  it('accepts plain identifiers, including $ and a leading underscore', () => {
    const abi = {
      ...base(),
      methods: [
        { name: '_get$1', params: [{ name: '$a', type: { kind: 'string' } }] },
      ],
    };
    expect(() => parseAbiManifest(abi)).not.toThrow();
  });
});

describe('a field name with serde-rename characters', () => {
  const FIELDS = [`data-"q"${PAYLOAD}`, 'tail\\'];
  const abi = () => ({
    ...base(),
    types: {
      Blob: {
        kind: 'record',
        fields: FIELDS.map((name) => ({ name, type: { kind: 'bytes' } })),
      },
    },
    methods: [{ name: 'get_blob', params: [], returns: { $ref: 'Blob' } }],
  });
  const dir = path.join(__dirname, '../tmp/injection');

  afterEach(() => {
    delete (globalThis as any).__injected;
  });

  it('is emitted as a literal, so the client imports without running it and round-trips the field', async () => {
    const source = generateClient(parseAbiManifest(abi()), 'Safe');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'safe.ts');
    fs.writeFileSync(file, mockMeroImport(source));

    const mod: any = await import(/* @vite-ignore */ pathToFileURL(file).href);
    expect((globalThis as any).__injected).toBeUndefined();

    const wire = Object.fromEntries(FIELDS.map((name) => [name, [1, 2, 3]]));
    const transport = { execute: async () => wire };
    const blob = await new mod.Safe(transport, 'ctx').getBlob();
    expect((globalThis as any).__injected).toBeUndefined();
    for (const name of FIELDS) expect(blob[name].toArray()).toEqual([1, 2, 3]);
  });

  it('still typechecks', () => {
    typecheckGeneratedClient(
      generateClient(parseAbiManifest(abi()), 'Safe'),
      '',
      'injection-typecheck',
    );
  });
});

describe('generateClient without parseAbiManifest', () => {
  it('refuses a method name that is not an identifier once camel-cased', () => {
    const manifest = {
      ...base(),
      methods: [{ name: METHOD, params: [] }],
    };
    expect(() => generateClient(manifest as any, 'Direct')).toThrow(
      'Invalid method name',
    );
  });

  it('refuses a method name that camel-cases to nothing', () => {
    const manifest = { ...base(), methods: [{ name: '_', params: [] }] };
    expect(() => generateClient(manifest as any, 'Direct')).toThrow(
      'Invalid method name',
    );
  });
});

describe('a __proto__ field name', () => {
  it('stays a data key on the decoded record', async () => {
    const abi = {
      ...base(),
      types: {
        Blob: {
          kind: 'record',
          fields: [{ name: '__proto__', type: { kind: 'bytes' } }],
        },
      },
      methods: [{ name: 'get_blob', params: [], returns: { $ref: 'Blob' } }],
    };
    const source = generateClient(parseAbiManifest(abi), 'Proto');
    const dir = path.join(__dirname, '../tmp/injection');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'proto.ts');
    fs.writeFileSync(file, mockMeroImport(source));

    const mod: any = await import(/* @vite-ignore */ pathToFileURL(file).href);
    const wire = JSON.parse('{"__proto__": [1, 2, 3]}');
    const blob = await new mod.Proto(
      { execute: async () => wire },
      'c',
    ).getBlob();
    expect(Object.getPrototypeOf(blob)).toBe(Object.prototype);
    expect(Object.keys(blob)).toEqual(['__proto__']);
  });
});
