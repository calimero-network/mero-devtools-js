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
  ({ Client } = await importClient('abi_conformance.json', 'Client'));
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
    const payload = await callAndCapture('act', { a: { name: 'SetName', payload: 'ada' } });
    expect(payload.argsJson).toEqual({ a: { SetName: 'ada' } });
  });

  it('sends a unit variant param as a bare string', async () => {
    const payload = await callAndCapture('act', { a: { name: 'Ping' } });
    expect(payload.argsJson).toEqual({ a: 'Ping' });
  });

  it('converts bytes carried inside a rewritten variant param', async () => {
    const payload = await callAndCapture(
      'runCommand',
      { cmd: newtypes.Command.Store(newtypes.CalimeroBytes.fromHex('00ff')), label: 'x' },
      newtypes.NT,
    );
    expect(payload.argsJson).toEqual({ cmd: { Store: [0, 255] }, label: 'x' });
  });
});
