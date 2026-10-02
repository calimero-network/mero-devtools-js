import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

// Swaps the mero-react import for a local type so a generated client compiles
// and runs without the dependency installed.
export function mockMeroImport(clientContent: string): string {
  return clientContent.replace(
    `import type {\n  ExecuteTransport,\n} from '@calimero-network/mero-react';`,
    `type ExecuteTransport = { execute: (params: any) => Promise<any> };`,
  );
}

// Typechecks a generated client with `assertions` appended; throws on any error.
export function typecheckGeneratedClient(
  clientContent: string,
  assertions: string,
  dirName: string,
): void {
  const tmpDir = path.join(__dirname, '../tmp', dirName);
  fs.mkdirSync(tmpDir, { recursive: true });

  fs.writeFileSync(
    path.join(tmpDir, 'client.ts'),
    mockMeroImport(clientContent) + assertions,
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
        // codegen-example's tsconfig sets noUnusedLocals, so an unused `response`
        // binding on a void-returning method must fail here too
        noUnusedLocals: true,
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
    throw new Error(
      `tsc rejected the generated client:\n${error.stdout || error.stderr}`,
    );
  }
}
