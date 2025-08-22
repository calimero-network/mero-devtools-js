# @calimero/abi-codegen

A WASM-ABI v1 parser and code generator for Calimero applications.

## Installation

```bash
npm install @calimero/abi-codegen
```

## Usage

### CLI

```bash
# Basic usage
npx calimero-abi-codegen -i abi.json -o src

# With custom client name
npx calimero-abi-codegen -i abi.json -o src --client-name MyClient

# Validate ABI manifest only
npx calimero-abi-codegen --validate -i abi.json
```

### Programmatic

```typescript
import { loadAbiManifestFromFile } from '@calimero/abi-codegen/parse';
import { generateTypes } from '@calimero/abi-codegen/generate/types';
import { generateClient } from '@calimero/abi-codegen/generate/client';

const manifest = loadAbiManifestFromFile('./abi.json');
const typesContent = generateTypes(manifest);
const clientContent = generateClient(manifest, 'MyClient');
```

## Generated Files

- **types.ts** - TypeScript type definitions
- **{ClientName}.ts** - Client class with ABI methods

## Examples

See the [codegen-example](../codegen-example) for a complete React example.

## Development

```bash
npm install
npm run build
npm run test
``` 