#!/usr/bin/env node
// Node-level e2e for the generator: a live merod serves the ABI of an app it has
// installed, abi-codegen turns that ABI into a client, and the client is driven
// against that same node and asserted on the values it really returns.
//
// Needs no Rust toolchain and no core checkout - merod and the app bundle are
// both release assets. Override the release with CORE_RELEASE_TAG, or point
// MEROD_BINARY at a merod you already have.
//
//   pnpm --filter codegen-example e2e

import { execFileSync, spawn } from 'child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const SERVER_PORT = 2574; // non-default, so a run never disturbs a node someone is using
const SWARM_PORT = 2674;
const ADMIN_USER = 'dev'; // throwaway node; embedded auth enforces an 8-character password
const ADMIN_PASSWORD = 'dev-password';
const APP_ASSET = 'kv-store-test-fixture.mpk'; // the one prebuilt, signed app a core release ships
const CLIENT_NAME = 'KvStoreClient';
const RELEASES_API =
  'https://api.github.com/repos/calimero-network/core/releases?per_page=1';
const DOWNLOAD_BASE =
  'https://github.com/calimero-network/core/releases/download';
const HEALTH_ATTEMPTS = 60;
const MEROD_TARGETS = {
  'darwin-arm64': 'aarch64-apple-darwin',
  'linux-x64': 'x86_64-unknown-linux-gnu',
  'linux-arm64': 'aarch64-unknown-linux-gnu',
};

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(__dirname, '..');
const repoRoot = resolve(pkgRoot, '..');
// Generated under tmp/ (git-ignored) rather than src/generated/: the committed
// goldens have their own in-sync gate and this output is thrown away each run.
const workDir = join(pkgRoot, 'tmp', 'e2e');
const cacheDir = join(pkgRoot, 'tmp', 'e2e-cache');
const nodeLog = join(repoRoot, 'merod-e2e.log');

/** Carries an operator-readable message; anything else prints a stack. */
class E2eError extends Error {}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function resolveTag() {
  if (process.env.CORE_RELEASE_TAG?.trim()) {
    return process.env.CORE_RELEASE_TAG.trim();
  }
  // Includes pre-releases on purpose: core currently publishes only release
  // candidates, so there is no GitHub "latest" to ask for.
  const res = await fetch(RELEASES_API, {
    headers: { 'User-Agent': 'mero-devtools-js-e2e' },
  });
  if (!res.ok) {
    throw new E2eError(
      `could not list core releases (${res.status}). Set CORE_RELEASE_TAG to pin one.`,
    );
  }
  const tag = (await res.json())[0]?.tag_name;
  if (!tag) throw new E2eError('calimero-network/core published no releases');
  return tag;
}

async function download(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new E2eError(`GET ${url} -> ${res.status}`);
  writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
}

async function resolveMerod(tag) {
  if (process.env.MEROD_BINARY?.trim()) {
    const path = process.env.MEROD_BINARY.trim();
    if (!existsSync(path)) {
      throw new E2eError(
        `MEROD_BINARY points at ${path}, which does not exist`,
      );
    }
    return path;
  }

  const target = MEROD_TARGETS[`${process.platform}-${process.arch}`];
  if (!target) {
    throw new E2eError(
      `no merod release asset for ${process.platform}-${process.arch}. ` +
        'Set MEROD_BINARY to a merod you built or downloaded yourself.',
    );
  }

  const dir = join(cacheDir, tag);
  const binary = join(dir, 'merod');
  if (existsSync(binary)) return binary;

  mkdirSync(dir, { recursive: true });
  const tarball = join(dir, 'merod.tar.gz');
  console.log(`  downloading merod_${target} @ ${tag}`);
  await download(`${DOWNLOAD_BASE}/${tag}/merod_${target}.tar.gz`, tarball);
  execFileSync('tar', ['xzf', tarball, '-C', dir]);
  rmSync(tarball);
  return binary;
}

async function resolveAppBundle(tag) {
  const dir = join(cacheDir, tag);
  const bundle = join(dir, APP_ASSET);
  if (existsSync(bundle)) return bundle;

  mkdirSync(dir, { recursive: true });
  console.log(`  downloading ${APP_ASSET} @ ${tag}`);
  await download(`${DOWNLOAD_BASE}/${tag}/${APP_ASSET}`, bundle);
  return bundle;
}

function runToCompletion(cmd, args, env) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(cmd, args, {
      env,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('error', (err) =>
      reject(new E2eError(`${cmd} failed to start: ${err.message}`)),
    );
    child.on('close', (code) =>
      code === 0
        ? resolvePromise()
        : reject(
            new E2eError(
              `${cmd} ${args.join(' ')} exited ${code}\n${stderr.slice(-800)}`,
            ),
          ),
    );
  });
}

async function portIsFree(port) {
  try {
    await fetch(`http://localhost:${port}/admin-api/health`, {
      signal: AbortSignal.timeout(1000),
    });
    return false;
  } catch {
    return true;
  }
}

/** Boots a throwaway node in a temp home; `stop` is safe however far boot got. */
async function bootNode(merod) {
  if (!(await portIsFree(SERVER_PORT))) {
    throw new E2eError(
      `something is already listening on ${SERVER_PORT} - stop it and re-run`,
    );
  }

  const home = mkdtempSync(join(tmpdir(), 'mero-codegen-e2e-'));
  const url = `http://localhost:${SERVER_PORT}`;
  let child;

  const stop = () => {
    try {
      child?.kill('SIGKILL');
    } catch {
      /* already gone */
    }
    rmSync(home, { recursive: true, force: true });
  };

  try {
    const env = {
      ...process.env,
      MERO_AUTH_ADMIN_USER: ADMIN_USER,
      MERO_AUTH_ADMIN_PASSWORD: ADMIN_PASSWORD,
    };
    const base = ['--home', home, '--node', 'codegen-e2e'];
    await runToCompletion(
      merod,
      [
        ...base,
        'init',
        '--server-port',
        String(SERVER_PORT),
        '--swarm-port',
        String(SWARM_PORT),
        '--auth-mode',
        'embedded',
      ],
      env,
    );

    const log = openSync(nodeLog, 'w');
    child = spawn(merod, [...base, 'run'], {
      env,
      stdio: ['ignore', log, log],
    });
    child.on('error', (err) => console.error(`  [merod] ${err.message}`));

    for (let i = 0; i < HEALTH_ATTEMPTS; i++) {
      try {
        const res = await fetch(`${url}/admin-api/health`, {
          signal: AbortSignal.timeout(1000),
        });
        if (res.ok) return { url, stop };
      } catch {
        /* not up yet */
      }
      await sleep(500);
    }
    throw new E2eError(`merod never became healthy on ${url}, see ${nodeLog}`);
  } catch (err) {
    stop();
    throw err;
  }
}

/**
 * Provisioning goes over raw HTTP rather than through the SDK: the generated
 * client is the subject here, so nothing it depends on may set the stage.
 */
function adminApi(url, token) {
  const call = async (method, path, body) => {
    const res = await fetch(`${url}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) {
      throw new E2eError(
        `${method} ${path} -> ${res.status}: ${text.slice(0, 300)}`,
      );
    }
    return JSON.parse(text).data;
  };
  return {
    get: (path) => call('GET', path),
    post: (path, body) => call('POST', path, body),
  };
}

async function login(url) {
  const res = await fetch(`${url}/auth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      auth_method: 'user_password',
      public_key: ADMIN_USER,
      client_name: 'codegen-e2e',
      permissions: ['admin'],
      timestamp: Math.floor(Date.now() / 1000),
      provider_data: { username: ADMIN_USER, password: ADMIN_PASSWORD },
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new E2eError(
      `admin login failed (${res.status}): ${text.slice(0, 300)}`,
    );
  }
  return JSON.parse(text).data.access_token;
}

/**
 * Generates the client from `abi`, then compiles it with tsc - which typechecks
 * the emitted TypeScript against the real SDK on the way to something runnable.
 * The package.json marks the output ESM, since this package itself is CommonJS.
 */
async function generateClient(abi) {
  const cli = join(repoRoot, 'abi-codegen', 'dist', 'cli.js');
  if (!existsSync(cli)) {
    throw new E2eError(`${cli} does not exist - run \`pnpm build\` first`);
  }

  rmSync(workDir, { recursive: true, force: true });
  mkdirSync(workDir, { recursive: true });
  const abiPath = join(workDir, 'abi.json');
  writeFileSync(abiPath, JSON.stringify(abi));
  writeFileSync(join(workDir, 'package.json'), '{ "type": "module" }\n');

  await runToCompletion(
    process.execPath,
    [cli, '-i', abiPath, '-o', workDir, '--client-name', CLIENT_NAME],
    process.env,
  );

  const source = join(workDir, `${CLIENT_NAME}.ts`);
  if (!existsSync(source)) {
    throw new E2eError(
      `the generator wrote no ${CLIENT_NAME}.ts into ${workDir}`,
    );
  }
  execFileSync(
    'pnpm',
    [
      'exec',
      'tsc',
      source,
      '--outDir',
      workDir,
      '--module',
      'esnext',
      '--moduleResolution',
      'bundler',
      '--target',
      'es2022',
      '--strict',
      '--skipLibCheck',
    ],
    { cwd: pkgRoot, stdio: 'inherit' },
  );

  return join(workDir, `${CLIENT_NAME}.js`);
}

const failures = [];
let checked = 0;

async function check(label, fn) {
  checked += 1;
  const prefix = String(checked).padStart(2);
  try {
    await fn();
    console.log(`${prefix} PASS  ${label}`);
  } catch (err) {
    failures.push(label);
    console.log(`${prefix} FAIL  ${label}`);
    for (const line of String(err.message).split('\n')) {
      console.log(`      ${line}`);
    }
  }
}

function eq(actual, expected, what) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(`${what}\nexpected: ${e}\nactual:   ${a}`);
  }
}

async function rejection(fn, what) {
  try {
    await fn();
  } catch (err) {
    return err;
  }
  throw new Error(`${what}: the call resolved instead of rejecting`);
}

async function main() {
  const tag = await resolveTag();
  console.log(`core release: ${tag}`);
  const merod = await resolveMerod(tag);
  const bundle = await resolveAppBundle(tag);

  const node = await bootNode(merod);
  try {
    const api = adminApi(node.url, await login(node.url));
    const { applicationId } = await api.post(
      '/admin-api/install-dev-application',
      { path: bundle },
    );
    const { namespaceId } = await api.post('/admin-api/namespaces', {
      applicationId,
    });
    const { contextId } = await api.post('/admin-api/contexts', {
      applicationId,
      groupId: namespaceId,
      initializationParams: [],
    });
    console.log(`context: ${contextId}`);

    const abi = await api.get(`/admin-api/applications/${applicationId}/abi`);
    const clientModule = await generateClient(abi);

    const { MeroJs } = await import('@calimero-network/mero-react');
    const { [CLIENT_NAME]: Client } = await import(clientModule);
    const mero = new MeroJs({ baseUrl: node.url });
    await mero.authenticate({
      username: ADMIN_USER,
      password: ADMIN_PASSWORD,
    });
    const kv = new Client(mero, contextId);

    console.log('');
    await check('the node serves a wasm-abi/1 manifest', () =>
      eq(abi.schema_version, 'wasm-abi/1', 'schema_version'),
    );
    await check('a fresh context is empty', async () =>
      eq(await kv.len(), 0, 'len()'),
    );
    await check('a unit-returning method resolves', async () =>
      eq(await kv.set({ key: 'alpha', value: 'one' }), null, 'set()'),
    );
    await check('the written value reads back', async () =>
      eq(await kv.get({ key: 'alpha' }), 'one', 'get(alpha)'),
    );
    await check('the write is counted', async () =>
      eq(await kv.len(), 1, 'len()'),
    );
    await check('a present key updates in place', async () => {
      eq(
        await kv.updateIfExists({ key: 'alpha', value: 'two' }),
        true,
        'updateIfExists(alpha)',
      );
      eq(await kv.get({ key: 'alpha' }), 'two', 'get(alpha)');
    });
    await check('an absent key does not update', async () =>
      eq(
        await kv.updateIfExists({ key: 'ghost', value: 'x' }),
        false,
        'updateIfExists(ghost)',
      ),
    );
    await check('get-or-insert keeps the first value', async () => {
      eq(
        await kv.getOrInsert({ key: 'beta', value: 'first' }),
        'first',
        'getOrInsert(beta) inserting',
      );
      eq(
        await kv.getOrInsert({ key: 'beta', value: 'second' }),
        'first',
        'getOrInsert(beta) again',
      );
    });
    await check('a map return round-trips whole', async () =>
      eq(await kv.entries(), { alpha: 'two', beta: 'first' }, 'entries()'),
    );
    await check('an absent key reads as null', async () =>
      eq(await kv.get({ key: 'ghost' }), null, 'get(ghost)'),
    );
    await check('an app error surfaces as a typed rejection', async () => {
      const err = await rejection(
        () => kv.getResult({ key: 'ghost' }),
        'getResult(ghost)',
      );
      eq(err.type, 'FunctionCallError', 'rejection type');
    });
    await check('remove returns the value it took out', async () =>
      eq(await kv.remove({ key: 'beta' }), 'first', 'remove(beta)'),
    );
    await check('clear empties the store', async () => {
      await kv.clear();
      eq(await kv.len(), 0, 'len()');
      eq(await kv.entries(), {}, 'entries()');
    });

    mero.close();
  } finally {
    node.stop();
    rmSync(workDir, { recursive: true, force: true });
  }

  const passed = checked - failures.length;
  console.log(`\n${passed} passed, ${failures.length} failed, 0 skipped`);
  for (const label of failures) console.log(`  FAILED: ${label}`);
  process.exit(failures.length ? 1 : 0);
}

main().catch((err) => {
  if (err instanceof E2eError) console.error(`\n✖ ${err.message}`);
  else console.error('\n✖', err);
  process.exit(1);
});
