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
let wire: any;

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
  wire = await importClient('serde_wire_abi.json', 'Wire');
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

// Wire examples from core's serde tagging tests: mero-design `ElementData`
// (internal), mero-drive `Change` (untagged) and `DriveError`-style `Outcome` (adjacent).
describe('serde enum tagging', () => {
  const element = (data: unknown) => ({
    id: 'e1',
    data,
    strokeWidth: 2,
    shadowColor: '#000',
    cornerRadius: null,
  });

  const roundTrip = async (method: string, param: string, value: unknown) => {
    const sent = await callAndCapture(method, { [param]: value }, wire.Wire);
    const received = await callWithResponse(method, value, wire.Wire);
    return { sent: sent.argsJson[param], received };
  };

  it('sends and reads an internally tagged enum as tag plus payload fields', async () => {
    for (const data of [
      { kind: 'rect' },
      { kind: 'line', points: '0,0 10,10' },
      { kind: 'text', content: 'hi', fontSize: 12, bold: true },
      { kind: 'image', naturalWidth: 64, blobId: 'b1' },
    ]) {
      const { sent, received } = await roundTrip(
        'addElement',
        'element',
        element(data),
      );
      expect(sent).toEqual(element(data));
      expect(received).toEqual(element(data));
    }
  });

  it('sends and reads an untagged enum as its bare payload', async () => {
    for (const change of [
      { retain: 6, attributes: { bold: 'true' } },
      { insert: 'hi', attributes: null },
      { delete: 2 },
    ]) {
      const { sent, received } = await roundTrip(
        'applyDelta',
        'change',
        change,
      );
      expect(sent).toEqual(change);
      expect(received).toEqual(change);
    }
  });

  it('sends and reads an adjacently tagged enum under tag and content', async () => {
    for (const outcome of [
      { kind: 'NotFound', data: 'doc' },
      { kind: 'Done' },
    ]) {
      const { sent, received } = await roundTrip('settle', 'outcome', outcome);
      expect(sent).toEqual(outcome);
      expect(received).toEqual(outcome);
    }
  });

  it('decodes bytes beside the tag of an internally tagged payload', async () => {
    const file = await callWithResponse(
      'attachment',
      { kind: 'file', hash: [0, 255] },
      wire.Wire,
    );
    expect(file.kind).toBe('file');
    expect(file.hash).toBeInstanceOf(wire.CalimeroBytes);
    expect(file.hash.toArray()).toEqual([0, 255]);
    expect(
      await callWithResponse('attachment', { kind: 'none' }, wire.Wire),
    ).toEqual({ kind: 'none' });
  });

  it('decodes bytes under the content key of an adjacently tagged payload', async () => {
    const stored = await callWithResponse(
      'receipt',
      { kind: 'Stored', data: [7] },
      wire.Wire,
    );
    expect(stored.data).toBeInstanceOf(wire.CalimeroBytes);
    expect(stored.data.toArray()).toEqual([7]);
    expect(
      await callWithResponse('receipt', { kind: 'Missing' }, wire.Wire),
    ).toEqual({ kind: 'Missing' });
  });

  it('keeps a non-identifier field name as its wire key', async () => {
    const { sent, received } = await roundTrip('setStyle', 'style', {
      'line-cap': 'round',
    });
    expect(sent).toEqual({ 'line-cap': 'round' });
    expect(received).toEqual({ 'line-cap': 'round' });
  });
});
