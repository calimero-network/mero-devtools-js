import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { loadAbiManifestFromFile } from '../src/parse.js';
import { generateClient } from '../src/generate/client.js';
import type { AbiManifest } from '../src/model.js';

// The rest of the suite asserts the emitted *source text*. That cannot tell a
// correct payload from a renamed field, so this one actually runs a generated
// client and inspects what reaches rpc.execute.
let Client: any;
let conformance: any;
let newtypes: any;

async function importClient(fixture: string, clientName: string): Promise<any> {
  const manifest = loadAbiManifestFromFile(
    path.join(__dirname, '../__fixtures__', fixture),
  );
  return importGenerated(manifest, clientName);
}

async function importGenerated(
  manifest: AbiManifest,
  clientName: string,
): Promise<any> {
  const source = generateClient(manifest, clientName).replace(
    `import {\n  MeroJs,\n} from '@calimero-network/mero-react';`,
    `type MeroJs = { rpc: { execute: (params: any) => Promise<any> } };`,
  );

  const dir = path.join(__dirname, '../tmp/rpc-payload', clientName);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'client.ts');
  fs.writeFileSync(file, source);

  return import(pathToFileURL(file).href);
}

beforeAll(async () => {
  conformance = await importClient('abi_conformance.json', 'Client');
  Client = conformance.Client;
  newtypes = await importClient('newtypes_abi.json', 'NT');
});

function callAndCapture(
  method: string,
  args: Record<string, unknown>,
  ClientClass: any = Client,
) {
  let captured: any;
  const mero = {
    rpc: {
      execute: async (p: any) => {
        captured = p;
        return 0;
      },
    },
  };
  const client = new ClientClass(mero, 'ctx-1');
  return Promise.resolve(client[method](args)).then(() => captured);
}

// The mirror of callAndCapture: feeds a wire-shaped response in and returns
// what the generated method hands back to the caller.
function callWithResponse(
  method: string,
  response: unknown,
  ClientClass: any = Client,
) {
  const mero = { rpc: { execute: async () => response } };
  return new ClientClass(mero, 'ctx-1')[method]({});
}

describe('rpc.execute payload', () => {
  it('sends exactly contextId, method and argsJson — no executor key', async () => {
    const payload = await callAndCapture('optU32', { x: 7 });

    expect(Object.keys(payload).sort()).toEqual([
      'argsJson',
      'contextId',
      'method',
    ]);
    expect(payload).toEqual({
      contextId: 'ctx-1',
      method: 'opt_u32',
      argsJson: { x: 7 },
    });
  });

  it('passes the context id through unchanged', async () => {
    const payload = await callAndCapture('optU32', { x: 1 });
    expect(payload.contextId).toBe('ctx-1');
  });

  it('sends a payload-bearing variant param as { Variant: payload }', async () => {
    const payload = await callAndCapture('act', {
      a: { name: 'SetName', payload: 'ada' },
    });
    expect(payload.argsJson).toEqual({ a: { SetName: 'ada' } });
  });

  it('sends a unit variant param as a bare string', async () => {
    const payload = await callAndCapture('act', { a: { name: 'Ping' } });
    expect(payload.argsJson).toEqual({ a: 'Ping' });
  });

  it('converts bytes carried inside a rewritten variant param', async () => {
    const payload = await callAndCapture(
      'runCommand',
      {
        cmd: newtypes.Command.Store(newtypes.CalimeroBytes.fromHex('00ff')),
        label: 'x',
      },
      newtypes.NT,
    );
    expect(payload.argsJson).toEqual({ cmd: { Store: [0, 255] }, label: 'x' });
  });
});

describe('rpc.execute response decode', () => {
  it('untags a payload-bearing variant member', async () => {
    const status = await callWithResponse('getStatus', {
      Active: { timestamp: 7 },
    });
    expect(status).toEqual({ name: 'Active', payload: { timestamp: 7 } });
  });

  it('untags a unit member sent as a bare string', async () => {
    const status = await callWithResponse('getStatus', 'Pending');
    expect(status).toEqual({ name: 'Pending' });
  });

  it('leaves an all-unit variant return alone', async () => {
    const role = await callWithResponse('getRole', 'Editor', newtypes.NT);
    expect(role).toBe('Editor');
  });

  it('wraps a declared bytes return in CalimeroBytes', async () => {
    const bytes = await callWithResponse('echoBytes', [1, 2, 3]);
    expect(bytes).toBeInstanceOf(conformance.CalimeroBytes);
    expect(bytes.toArray()).toEqual([1, 2, 3]);
  });

  it('leaves a declared list<u32> as plain numbers, alone or beside bytes', async () => {
    const numbers = await callWithResponse('listU32', [1, 2, 3]);
    expect(numbers).not.toBeInstanceOf(conformance.CalimeroBytes);
    expect(numbers).toEqual([1, 2, 3]);

    // Same declaration reached through a return that does carry bytes, which is
    // where a shape-guessing decoder mistakes it for a byte array.
    const command = await callWithResponse(
      'lastCommand',
      { Scores: [1, 2, 3] },
      newtypes.NT,
    );
    expect(command.payload).not.toBeInstanceOf(newtypes.CalimeroBytes);
    expect(command).toEqual({ name: 'Scores', payload: [1, 2, 3] });
  });

  it('converts only the bytes field of a record that also holds a list', async () => {
    const profile = await callWithResponse('profileRoundtrip', {
      bio: 'hi',
      avatar: [1, 2],
      nicknames: [],
    });
    expect(profile.avatar).toBeInstanceOf(conformance.CalimeroBytes);
    expect(profile.avatar.toArray()).toEqual([1, 2]);
    expect(profile.nicknames).not.toBeInstanceOf(conformance.CalimeroBytes);
    expect(profile.nicknames).toEqual([]);
    expect(profile.bio).toBe('hi');
  });

  // An empty array satisfies `every(item => typeof item === 'number')`
  // vacuously, so shape-guessing turned every empty collection into bytes.
  it('leaves an empty collection empty whatever its declared item type', async () => {
    expect(await callWithResponse('listIds', [])).toEqual([]);
    expect(await callWithResponse('listRecords', [])).toEqual([]);
    expect(await callWithResponse('mapRecord', {})).toEqual({});
  });

  it('passes a null nullable return through untouched', async () => {
    expect(await callWithResponse('optId', null)).toBeNull();
  });

  it('passes null through a return the manifest did not declare nullable', async () => {
    expect(await callWithResponse('findPerson', null)).toBeNull();
    expect(await callWithResponse('echoBytes', null)).toBeNull();
    expect(await callWithResponse('getStatus', null)).toBeNull();
    expect(await callWithResponse('lastCommand', null, newtypes.NT)).toBeNull();
  });

  it('decodes both the tag and the bytes of a variant payload', async () => {
    const command = await callWithResponse(
      'lastCommand',
      { Store: [0, 255] },
      newtypes.NT,
    );
    expect(command.name).toBe('Store');
    expect(command.payload).toBeInstanceOf(newtypes.CalimeroBytes);
    expect(command.payload.toArray()).toEqual([0, 255]);
  });
});

// The three non-default serde enum representations: internally tagged
// (`WireShape`, tag "kind"), adjacently tagged (`WireOutcome`, tag "kind",
// content "data") and untagged (`WireStep`). All three reach the client inside
// `echo_wire`'s record, so it exercises the recursive decode.
describe('tagged and untagged enums', () => {
  it('decodes an internally tagged payload variant without its tag', async () => {
    const w = await callWithResponse('echoWire', {
      strokeWidth: 1,
      blobId: 'b',
      shape: { kind: 'text', fontSize: 12 },
      step: { retain: 3 },
      outcome: { kind: 'Failed', data: 'x' },
    });
    expect(w.shape).toEqual({ name: 'text', payload: { fontSize: 12 } });
    expect(w.outcome).toEqual({ name: 'Failed', payload: 'x' });
    expect(w.step).toEqual({ retain: 3 });
    expect(w.strokeWidth).toBe(1);
  });

  it('decodes tagged unit variants to a bare name', async () => {
    const w = await callWithResponse('echoWire', {
      strokeWidth: 1,
      blobId: 'b',
      shape: { kind: 'rect' },
      step: { insert: 'hi' },
      outcome: { kind: 'Done' },
    });
    expect(w.shape).toEqual({ name: 'rect' });
    expect(w.outcome).toEqual({ name: 'Done' });
    expect(w.step).toEqual({ insert: 'hi' });
  });

  it('keeps an unknown tagged variant rather than dropping it', async () => {
    const w = await callWithResponse('echoWire', {
      strokeWidth: 1,
      blobId: 'b',
      shape: { kind: 'circle', r: 2 },
      step: { retain: 0 },
      outcome: { kind: 'Pending', data: 7 },
    });
    expect(w.shape).toEqual({ name: 'circle', payload: { r: 2 } });
    expect(w.outcome).toEqual({ name: 'Pending', payload: 7 });
  });

  describe('as top-level params', () => {
    let Tagged: any;

    beforeAll(async () => {
      const text = { $ref: 'Shape_Text' };
      const manifest: AbiManifest = {
        schema_version: 'wasm-abi/1',
        types: {
          Shape: {
            kind: 'variant',
            tag: 'kind',
            variants: [{ name: 'rect' }, { name: 'text', payload: text }],
          },
          Shape_Text: {
            kind: 'record',
            fields: [{ name: 'fontSize', type: { kind: 'u32' } }],
          },
          Outcome: {
            kind: 'variant',
            tag: 't',
            content: 'c',
            variants: [
              { name: 'Done' },
              { name: 'Failed', payload: { kind: 'string' } },
            ],
          },
          Step: {
            kind: 'variant',
            untagged: true,
            variants: [
              { name: 'Retain', payload: { kind: 'u32' } },
              { name: 'Skip' },
            ],
          },
        },
        methods: [
          {
            name: 'draw',
            params: [
              { name: 's', type: { $ref: 'Shape' } },
              { name: 'o', type: { $ref: 'Outcome' } },
              { name: 'st', type: { $ref: 'Step' } },
            ],
          },
        ],
        events: [],
      };
      Tagged = (await importGenerated(manifest, 'Tagged')).Tagged;
    });

    it('sends internal, adjacent and untagged variants in their wire shape', async () => {
      const payload = await callAndCapture(
        'draw',
        {
          s: { name: 'text', payload: { fontSize: 9 } },
          o: { name: 'Failed', payload: 'boom' },
          st: 4,
        },
        Tagged,
      );
      expect(payload.argsJson).toEqual({
        s: { kind: 'text', fontSize: 9 },
        o: { t: 'Failed', c: 'boom' },
        st: 4,
      });
    });

    it('sends tagged unit variants as an object carrying only the tag', async () => {
      const payload = await callAndCapture(
        'draw',
        { s: { name: 'rect' }, o: { name: 'Done' }, st: null },
        Tagged,
      );
      expect(payload.argsJson).toEqual({
        s: { kind: 'rect' },
        o: { t: 'Done' },
        st: null,
      });
    });
  });
});
