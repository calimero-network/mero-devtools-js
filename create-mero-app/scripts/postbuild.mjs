import { promises as fs } from 'node:fs';
import path from 'node:path';

const distEsm = path.resolve('dist/esm');
const distCjs = path.resolve('dist');

await fs.mkdir(distCjs, { recursive: true });

/**
 * tsc emits one file per module into dist/esm; the published CLI is a flat set
 * of .mjs files in dist/. The entry point becomes cli.mjs (that is the `bin`
 * target) and every other module is copied beside it under the same basename.
 *
 * The extension has to change on the imports too: dist/ has no package.json of
 * its own declaring `"type": "module"`, so a `.js` file there would be read as
 * CommonJS and an `import` inside it would throw at require time.
 */
const emitted = (await fs.readdir(distEsm)).filter((f) => f.endsWith('.js'));

for (const file of emitted) {
  const isEntry = file === 'index.js';
  const dest = path.join(distCjs, isEntry ? 'cli.mjs' : file.replace(/\.js$/, '.mjs'));

  let content = await fs.readFile(path.join(distEsm, file), 'utf8');
  content = content.replace(/^#!.*\n/, '');
  // Relative imports point at siblings that were just renamed .js -> .mjs.
  content = content.replace(
    /(\bfrom\s+['"]\.\.?\/[^'"]+?)\.js(['"])/g,
    '$1.mjs$2',
  );
  if (isEntry) content = `#!/usr/bin/env node\n` + content;

  await fs.writeFile(dest, content, 'utf8');
  if (isEntry) await fs.chmod(dest, 0o755);

  console.log('Built', path.relative(process.cwd(), dest));
}
