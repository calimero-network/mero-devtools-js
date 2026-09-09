import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { loadAbiManifestFromFile } from '../src/parse.js';
import { generateClient } from '../src/generate/client.js';
import { parseAbiManifest } from '../src/parse.js';
import { brandBaseType } from '../src/generate/emit.js';

const newtypesAbiPath = path.join(__dirname, '../__fixtures__/newtypes_abi.json');

// A `@ts-expect-error` is an inverted assertion: tsc fails when the next line
// does NOT error. Against a plain `type FolderId = string` every one of these
// is an unused directive, so this file is a real gate rather than a snapshot.
const TYPE_ASSERTIONS = `
// --- a bare string is not a branded newtype ---
// @ts-expect-error bare string is not assignable to FolderId
const a1: FolderId = 'raw-string';

// --- two different newtypes are not interchangeable ---
declare const someFolderId: FolderId;
declare const someContextId: ContextId;
// @ts-expect-error FolderId is not assignable to ContextId
const a2: ContextId = someFolderId;
// @ts-expect-error ContextId is not assignable to FolderId
const a3: FolderId = someContextId;

// --- a newtype of a newtype is its own type ---
declare const nested: AliasOfFolderId;
// @ts-expect-error AliasOfFolderId is not assignable to FolderId
const a4: FolderId = nested;

// --- numeric newtypes brand too ---
// @ts-expect-error bare number is not assignable to Height
const a5: Height = 42;
declare const someHeight: Height;
// @ts-expect-error Height is not assignable to Ratio
const a6: Ratio = someHeight;

// --- method signatures carry the brand ---
declare const client: NT;
// @ts-expect-error a bare string cannot be passed where FolderId is required
client.getFolder({ id: 'raw-string' });

// --- positive: the constructor is the way in, and brands widen to their base ---
const ok1: FolderId = FolderId('folder-1');
const ok2: ContextId = ContextId('ctx-1');
const ok3: Height = Height(42);
const ok4: string = ok1;
const ok5: number = ok3;
client.getFolder({ id: ok1 });
client.bindContext({ folder_id: ok1, context_id: ok2 });

// --- a validating constructor brands exactly like a casting one ---
const okp1: Sha256Hex = Sha256Hex('0'.repeat(64));
const okp2: string = okp1;
// @ts-expect-error a bare string is not assignable to Sha256Hex
const a7: Sha256Hex = 'deadbeef';
// @ts-expect-error a sibling patterned newtype is not interchangeable
const a8: RoutePath = okp1;

// --- unbranded categories are untouched ---
const ok6: Flag = true;
const ok7: Tags = ['a', 'b'];
const ok8: Index = { k: 'v' };
const ok9: Hash32 = CalimeroBytes.fromHex('00');
// a bare-string field stays a bare string — branding cannot help until the
// app declares a newtype for it
declare const entry: FolderEntry;
const ok10: string = entry.member;

export type _Used = [
  typeof a1, typeof a2, typeof a3, typeof a4, typeof a5, typeof a6,
  typeof ok1, typeof ok2, typeof ok3, typeof ok4, typeof ok5,
  typeof ok6, typeof ok7, typeof ok8, typeof ok9, typeof ok10,
  typeof a7, typeof a8, typeof okp1, typeof okp2
];
`;

function mockMeroImport(clientContent: string): string {
  return clientContent.replace(
    `import {\n  MeroJs,\n} from '@calimero-network/mero-react';`,
    `type MeroJs = { rpc: { execute: (params: any) => Promise<any> } };`,
  );
}

// Import the generated client for real, so the emitted validation is executed
// rather than only string-matched.
async function importGeneratedClient(
  clientContent: string,
  dirName: string,
): Promise<unknown> {
  const tmpDir = path.join(__dirname, '../tmp', dirName);
  fs.mkdirSync(tmpDir, { recursive: true });
  const file = path.join(tmpDir, 'client.ts');
  fs.writeFileSync(file, mockMeroImport(clientContent));
  return import(/* @vite-ignore */ file);
}

function typecheckGeneratedClient(clientContent: string, dirName: string): void {
  const tmpDir = path.join(__dirname, '../tmp', dirName);
  fs.mkdirSync(tmpDir, { recursive: true });

  fs.writeFileSync(
    path.join(tmpDir, 'client.ts'),
    mockMeroImport(clientContent) + TYPE_ASSERTIONS,
  );
  fs.writeFileSync(
    path.join(tmpDir, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        target: 'ES2020',
        module: 'ESNext',
        moduleResolution: 'node',
        strict: true,
        noEmit: true,
        skipLibCheck: true,
      },
      include: ['*.ts'],
    }),
  );

  // `-p` with an explicit path is required: without it tsc walks up and picks
  // abi-codegen's own tsconfig, compiling src/ and never seeing this file.
  const tsconfigPath = path.join(tmpDir, 'tsconfig.json');
  try {
    execSync(`npx tsc --noEmit -p ${tsconfigPath}`, {
      cwd: tmpDir,
      stdio: 'pipe',
      encoding: 'utf-8',
    });
  } catch (error: any) {
    throw new Error(`tsc rejected the branded client:\n${error.stdout || error.stderr}`);
  }
}

describe('newtype branding', () => {
  const manifest = loadAbiManifestFromFile(newtypesAbiPath);

  it('makes bare strings and sibling newtypes mutually unassignable', () => {
    typecheckGeneratedClient(generateClient(manifest, 'NT'), 'branding');
  });

  it('emits a brand and a constructor for string and numeric newtypes', () => {
    const out = generateClient(manifest, 'NT');
    expect(out).toContain(
      "export type FolderId = string & { readonly __brand: 'FolderId' };",
    );
    expect(out).toContain(
      "export const FolderId = (value: string): FolderId => value as FolderId;",
    );
    expect(out).toContain(
      "export type Height = number & { readonly __brand: 'Height' };",
    );
    expect(out).toContain(
      "export const Height = (value: number): Height => value as Height;",
    );
  });

  it('leaves a self-referential alias alone instead of looping', () => {
    const cyclic = parseAbiManifest({
      schema_version: 'wasm-abi/1',
      types: {
        A: { kind: 'alias', target: { $ref: 'B' } },
        B: { kind: 'alias', target: { $ref: 'A' } },
      },
      methods: [],
      events: [],
    });
    expect(brandBaseType(cyclic.types.A, cyclic)).toBeNull();
    expect(brandBaseType(cyclic.types.B, cyclic)).toBeNull();
  });

  it('leaves non-primitive newtypes as plain aliases', () => {
    const out = generateClient(manifest, 'NT');
    expect(out).toContain('export type Hash32 = CalimeroBytes;');
    expect(out).toContain('export type Tags = string[];');
    expect(out).toContain('export type Index = Record<string, string>;');
    expect(out).toContain('export type Flag = boolean;');
    expect(out).toContain('export type AliasOfRecord = FolderEntry;');
  });

  it('checks a declared pattern before branding a string newtype', () => {
    const out = generateClient(manifest, 'NT');
    expect(out).toContain(
      'export const Sha256Hex = (value: string): Sha256Hex => {',
    );
    expect(out).toContain('if (!new RegExp("^[0-9a-f]{64}$").test(value)) {');
    expect(out).toContain(
      'throw new TypeError("Sha256Hex must match ^[0-9a-f]{64}$");',
    );
  });

  // A `/` in the pattern would close a regex literal early and emit code that
  // either fails to parse or silently matches something else.
  it('carries a pattern containing a slash through intact', () => {
    const out = generateClient(manifest, 'NT');
    expect(out).toContain(
      'if (!new RegExp("^/[a-z]+(/[a-z]+)*$").test(value)) {',
    );
  });

  it('brands a numeric newtype without a check even if it declares a pattern', () => {
    const out = generateClient(manifest, 'NT');
    expect(out).toContain(
      'export const OddHeight = (value: number): OddHeight => value as OddHeight;',
    );
    expect(out).not.toContain('OddHeight must match');
  });

  it('rejects a non-matching value and returns a matching one at runtime', async () => {
    const mod: any = await importGeneratedClient(
      generateClient(manifest, 'NT'),
      'branding-runtime',
    );
    const good = '0'.repeat(64);
    expect(mod.Sha256Hex(good)).toBe(good);
    expect(() => mod.Sha256Hex('nope')).toThrow(
      /Sha256Hex must match \^\[0-9a-f\]\{64\}\$/,
    );
    expect(mod.RoutePath('/a/b')).toBe('/a/b');
    expect(() => mod.RoutePath('a/b')).toThrow(TypeError);
    // the unchecked numeric newtype still just casts
    expect(mod.OddHeight(7)).toBe(7);
  });
});
