import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { loadAbiManifestFromFile } from '../src/parse.js';
import { generateClient } from '../src/generate/client.js';

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
