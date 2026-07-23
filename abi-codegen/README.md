# @calimero-network/abi-codegen

A WASM-ABI v1 parser and code generator for Calimero applications.

## Installation

```bash
npm install @calimero-network/abi-codegen
```

## Usage

### CLI

```bash
# Basic usage
npx calimero-abi-codegen -i abi.json -o src

# With custom client name
npx calimero-abi-codegen -i abi.json -o src --client-name MyClient

# Derive the client name from a file path (e.g. the .wasm binary)
npx calimero-abi-codegen -i abi.json -o src --name-from kv_store.wasm

# Point generated imports at a different runtime package
npx calimero-abi-codegen -i abi.json -o src --import-path @calimero-network/mero-js

# Validate ABI manifest only (no code generation)
npx calimero-abi-codegen --validate -i abi.json
```

Flags: `-i, --input <file>` (default `abi.json`), `-o, --output <dir>` (default `src`),
`--client-name <Name>`, `--name-from <path>`, `--import-path <path>` (default
`@calimero-network/mero-react`), `--validate`, `-h, --help`. Full details in the
[CLI reference](https://calimero-network.github.io/mero-devtools-js/reference/cli/).

### Programmatic

```typescript
import { loadAbiManifestFromFile } from '@calimero-network/abi-codegen/parse';
import { generateClient } from '@calimero-network/abi-codegen/generate/client';
import fs from 'node:fs';

const manifest = loadAbiManifestFromFile('./abi.json');
const clientContent = generateClient(manifest, 'MyClient');
fs.writeFileSync('src/generated/MyClient.ts', clientContent);
```

`generateClient` is self-contained: its output includes the type definitions and
the client class together. See the
[programmatic API reference](https://calimero-network.github.io/mero-devtools-js/reference/api/)
for the full surface (`parseAbiManifest`, `generateTypes`, and the naming utilities
in `generate/emit`).

## Generated Files

The CLI writes a **single** file, `{ClientName}.ts`, into the output directory.
Type definitions and the client class live together in that one file — there is
no separate `types.ts` module.

## Examples

See the [codegen-example](../codegen-example) for a complete React example.

## Development

```bash
npm install
npm run build
npm run test
``` 