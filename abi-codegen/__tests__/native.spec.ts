import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { execSync, spawnSync } from 'child_process';
import { loadAbiManifestFromFile } from '../src/parse.js';
import { generateSwiftClient } from '../src/generate/swift.js';
import { generateKotlinClient } from '../src/generate/kotlin.js';

// Every fixture the native targets are pinned on: the package's own plus copies
// of real app ABIs (forum and calendar for bytes, standup for a tagged enum).
const FIXTURES: Array<[file: string, client: string]> = [
  ['abi_conformance.json', 'ConformanceClient'],
  ['newtypes_abi.json', 'NewtypesClient'],
  ['serde_wire_abi.json', 'SerdeWireClient'],
  ['ludo_crdt_abi.json', 'LudoClient'],
  ['apps/mero_forum_abi.json', 'ForumClient'],
  ['apps/mero_standup_abi.json', 'StandupClient'],
  ['apps/mero_calendar_abi.json', 'CalendarClient'],
];
const PACKAGE = 'network.calimero.generated';

const fixture = (file: string) =>
  loadAbiManifestFromFile(path.join(__dirname, '../__fixtures__', file));
const snapshot = (name: string) =>
  path.join(__dirname, '__snapshots__/native', name);

describe('native targets', () => {
  describe.each(FIXTURES)('%s', (file, client) => {
    it('matches the Swift snapshot', async () => {
      await expect(
        generateSwiftClient(fixture(file), client),
      ).toMatchFileSnapshot(snapshot(`${client}.swift`));
    });

    it('matches the Kotlin snapshot', async () => {
      await expect(
        generateKotlinClient(fixture(file), client, PACKAGE),
      ).toMatchFileSnapshot(snapshot(`${client}.kt`));
    });
  });

  describe('forum', () => {
    const manifest = fixture('apps/mero_forum_abi.json');
    const swift = generateSwiftClient(manifest, 'ForumClient');
    const kotlin = generateKotlinClient(manifest, 'ForumClient', PACKAGE);

    it('sends read_only methods to query and the rest to execute', () => {
      expect(swift).toContain(
        'try await transport.query(method: "list_comments", argsJSON: args)',
      );
      expect(swift).toContain(
        'try await transport.execute(method: "create_post", argsJSON: args)',
      );
      // No declared intent is a write, as the node treats it.
      expect(swift).toContain(
        'try await transport.execute(method: "init", argsJSON: Data("{}".utf8))',
      );
      expect(kotlin).toContain('transport.query("list_comments", args)');
      expect(kotlin).toContain('transport.execute("create_post", args)');
    });

    it('defaults an optional argument to absent, with its wire name', () => {
      expect(swift).toContain(
        'public func listComments(postId: String, cursor: String? = nil, limit: UInt32) async throws -> CommentPage {',
      );
      expect(swift).toContain('case postId = "post_id"');
      expect(kotlin).toContain(
        'suspend fun listComments(postId: String, cursor: String? = null, limit: UInt): CommentPage {',
      );
      expect(kotlin).toContain('@SerialName("post_id") val postId: String,');
    });

    it("imports the SDK's transport instead of declaring one", () => {
      const sdkSwift = generateSwiftClient(manifest, 'ForumClient', 'MeroKit');
      expect(sdkSwift).toContain('import MeroKit');
      expect(sdkSwift).not.toContain('protocol ContextContractCalling');
      expect(sdkSwift).toContain(
        'public let transport: any ContextContractCalling',
      );
      expect(swift).toContain(
        'public protocol ContextContractCalling: Sendable {',
      );

      const sdkKotlin = generateKotlinClient(
        manifest,
        'ForumClient',
        PACKAGE,
        'com.calimero.mero.app.ContextContractCalling',
      );
      expect(sdkKotlin).toContain(
        'import com.calimero.mero.app.ContextContractCalling',
      );
      expect(sdkKotlin).not.toContain('interface ContextContractCalling');
      expect(kotlin).toContain('interface ContextContractCalling {');
    });

    it('drops a unit return', () => {
      expect(swift).toContain(
        'public func deleteComment(commentId: String) async throws {',
      );
      expect(kotlin).toContain(
        'suspend fun deleteComment(commentId: String) {',
      );
    });
  });

  it('writes the target the CLI is asked for', () => {
    const cli = path.join(__dirname, '../dist/cli.js');
    const out = path.join(__dirname, '../tmp/native-cli');
    const input = path.join(__dirname, '../__fixtures__/serde_wire_abi.json');
    fs.rmSync(out, { recursive: true, force: true });
    const run = (flags: string) =>
      execSync(`node ${cli} -i ${input} -o ${out} ${flags}`, {
        stdio: 'pipe',
        encoding: 'utf-8',
      });

    run('--target swift --client-name WireClient');
    run(`--target kotlin --client-name WireClient --package ${PACKAGE}`);
    expect(fs.readFileSync(path.join(out, 'WireClient.swift'), 'utf-8')).toBe(
      generateSwiftClient(fixture('serde_wire_abi.json'), 'WireClient'),
    );
    expect(fs.readFileSync(path.join(out, 'WireClient.kt'), 'utf-8')).toBe(
      generateKotlinClient(
        fixture('serde_wire_abi.json'),
        'WireClient',
        PACKAGE,
      ),
    );
    expect(() => run('--target rust')).toThrow();
  });
});

// Compiling the output needs the toolchains, so these run only where they exist:
// `swiftc` on PATH, and for Kotlin KOTLINC_HOME (a kotlinc distribution, e.g.
// Android Studio's plugins/Kotlin/kotlinc) plus KOTLINX_SERIALIZATION_CLASSPATH
// (the core and json jars).
const hasSwiftc = spawnSync('swiftc', ['--version']).status === 0;
const kotlincHome = process.env.KOTLINC_HOME;
const serializationClasspath = process.env.KOTLINX_SERIALIZATION_CLASSPATH;

describe('native output compiles', () => {
  const dir = (name: string) => {
    const tmpDir = path.join(__dirname, '../tmp/native', name);
    fs.mkdirSync(tmpDir, { recursive: true });
    return tmpDir;
  };

  it.skipIf(!hasSwiftc).each(FIXTURES)(
    'swiftc -typecheck %s',
    (file, client) => {
      const source = path.join(dir('swift'), `${client}.swift`);
      fs.writeFileSync(source, generateSwiftClient(fixture(file), client));
      const result = spawnSync('swiftc', ['-typecheck', source], {
        encoding: 'utf-8',
      });
      expect(result.stderr).toBe('');
      expect(result.status).toBe(0);
    },
    120_000,
  );

  it.skipIf(!kotlincHome || !serializationClasspath).each(FIXTURES)(
    'kotlinc %s',
    (file, client) => {
      const out = dir(`kotlin/${client}`);
      const source = path.join(out, `${client}.kt`);
      fs.writeFileSync(
        source,
        generateKotlinClient(fixture(file), client, PACKAGE),
      );
      const result = spawnSync(
        path.join(kotlincHome!, 'bin/kotlinc'),
        [
          `-Xplugin=${path.join(kotlincHome!, 'lib/kotlinx-serialization-compiler-plugin.jar')}`,
          '-cp',
          serializationClasspath!,
          '-d',
          path.join(out, 'classes'),
          source,
        ],
        { encoding: 'utf-8' },
      );
      expect(result.stderr).not.toMatch(/error:/);
      expect(result.status).toBe(0);
    },
    300_000,
  );
});
