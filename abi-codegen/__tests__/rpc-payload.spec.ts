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

beforeAll(async () => {
  const manifest = loadAbiManifestFromFile(
    path.join(__dirname, '../__fixtures__/abi_conformance.json'),
  );
  const source = generateClient(manifest, 'Client').replace(
    `import {\n  MeroJs,\n} from '@calimero-network/mero-react';`,
    `type MeroJs = { rpc: { execute: (params: any) => Promise<any> } };`,
  );

  const dir = path.join(__dirname, '../tmp/rpc-payload');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'client.ts');
  fs.writeFileSync(file, source);

  ({ Client } = await import(pathToFileURL(file).href));
});

function callAndCapture(method: string, args: Record<string, unknown>) {
  let captured: any;
  const mero = {
    rpc: {
      execute: async (p: any) => {
        captured = p;
        return 0;
      },
    },
  };
  const client = new Client(mero, 'ctx-1');
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
});
