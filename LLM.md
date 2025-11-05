# LLM Context: Calimero Mero DevTools JS

This document provides AI assistants with comprehensive knowledge about the `mero-devtools-js` repository and how to help developers build Calimero applications.

## Repository Overview

**Purpose**: Developer tooling for Calimero blockchain applications, focusing on generating TypeScript clients from WASM-ABI manifests and scaffolding new applications.

**Type**: pnpm monorepo with 3 packages

**Tech Stack**: TypeScript, Node.js >=18, ESM modules

## Package Structure

### 1. `abi-codegen` (@calimero-network/abi-codegen)

**Purpose**: WASM-ABI v1 parser and TypeScript code generator

**What it does**: Converts ABI manifest JSON files into typed TypeScript client code that developers can use to interact with Calimero smart contracts.

**Key Features**:
- Parses WASM-ABI v1 manifests (validates against JSON schema)
- Generates TypeScript type definitions for all ABI types, methods, and events
- Generates a client class with methods for all contract functions
- Supports custom client names and import paths
- CLI tool and programmatic API

**Published**: Yes, public on npm as `@calimero-network/abi-codegen`

**Current Version**: 0.1.1

**Entry Points**:
- CLI: `calimero-abi-codegen` (dist/cli.js)
- Main: `dist/index.js`
- Exports: parse, generate/types, generate/client, generate/emit

### 2. `create-mero-app`

**Purpose**: Scaffolding tool to quickly start new Calimero applications

**What it does**: Clones the `calimero-network/kv-store` example repository and copies its contents (excluding git artifacts) to a new project directory.

**Key Features**:
- Clones from `https://github.com/calimero-network/kv-store`
- Excludes: `.git`, `.github`, `.gitignore`, `.gitattributes`, `.gitmodules`, `node_modules`
- Automatically sets package.json name to match project directory
- Validates project name as valid npm package name

**Published**: Yes, public on npm as `create-mero-app`

**Current Version**: 0.1.0

**Usage**: `npx create-mero-app@latest my-project-name`

### 3. `codegen-example`

**Purpose**: Example React application demonstrating the generated client in action

**What it does**: Full ABI conformance test suite showing how to use the generated TypeScript client with the Calimero SDK.

**Key Features**:
- Comprehensive test coverage of all ABI types (primitives, records, variants, lists, maps, optionals)
- Demonstrates CalimeroProvider, useCalimero hook, and Context management
- Shows proper usage of CalimeroBytes for fixed-size byte arrays
- Examples of error handling with Result types
- Real-world integration with @calimero-network/calimero-client

**Published**: No (private package)

## Key Concepts

### WASM-ABI v1 Manifest

A JSON file describing a WebAssembly smart contract's interface:
- **Types**: Custom types (records, variants, enums, type aliases)
- **Methods**: Contract functions with parameters and return types
- **Events**: Events emitted by the contract
- **State**: The state structure (optional)

Schema: `abi-codegen/src/schema/wasm-abi-v1.schema.json`

### Generated Code Structure

The codegen produces two files:

1. **types.ts**: 
   - TypeScript interfaces for all custom types
   - Variant helper functions (factories for each variant case)
   - Event type unions
   - CalimeroBytes utility class for handling byte arrays

2. **{ClientName}.ts**:
   - Main client class that takes `CalimeroApp` and `Context`
   - Type-safe methods for each contract function
   - Automatic serialization/deserialization

### CalimeroBytes

A utility class for handling fixed-size byte arrays (like UserId32, Hash64):

```typescript
// From hex string
const userId = CalimeroBytes.fromHex('01'.repeat(32)); // 32 bytes

// From Uint8Array
const hash = CalimeroBytes.fromUint8Array(new Uint8Array(64));

// To Uint8Array
const bytes = userId.toUint8Array();

// To hex string
const hex = userId.toHex();
```

### Variants (Tagged Unions)

Generated as discriminated unions with helper factories:

```typescript
// Generated type
export type ActionPayload =
  | { name: 'Ping' }
  | { name: 'SetName'; payload: string }
  | { name: 'Update'; payload: UpdatePayload }

// Generated helpers
export const Action = {
  Ping: (): ActionPayload => ({ name: 'Ping' }),
  SetName: (setname: string): ActionPayload => ({ name: 'SetName', payload: setname }),
  Update: (update: UpdatePayload): ActionPayload => ({ name: 'Update', payload: update }),
} as const;

// Usage
const action = Action.SetName('John Doe');
await client.act({ a: action });
```

## Common Workflows

### For End Users (Building a Calimero App)

#### 1. Scaffold a New App
```bash
npx create-mero-app@latest my-calimero-app
cd my-calimero-app
pnpm install
```

#### 2. Generate TypeScript Client from ABI
```bash
# Basic usage
npx @calimero-network/abi-codegen -i path/to/abi.json -o src/generated

# With custom client name
npx @calimero-network/abi-codegen -i abi.json -o src/generated --client-name KvStoreClient

# Derive name from WASM file
npx @calimero-network/abi-codegen -i abi.json -o src/generated --name-from kv_store.wasm
# Creates: KvStoreClient

# Validate only (no codegen)
npx @calimero-network/abi-codegen --validate -i abi.json
```

#### 3. Use Generated Client in React App
```typescript
import React from 'react';
import { CalimeroProvider, useCalimero, CalimeroConnectButton, AppMode } from '@calimero-network/calimero-client';
import { KvStoreClient } from './generated/KvStoreClient';

const config = {
  clientApplicationId: 'YOUR_APP_ID',
  mode: AppMode.MultiContext,
  applicationPath: 'YOUR_APP_PATH',
};

function MyApp() {
  const { app, isAuthenticated } = useCalimero();
  
  const handleAction = async () => {
    if (!app || !isAuthenticated) return;
    
    // Create or get context
    const context = await app.createContext();
    
    // Initialize client
    const client = new KvStoreClient(app, context);
    
    // Call methods
    const result = await client.getValue({ key: 'myKey' });
    console.log(result);
  };
  
  return (
    <div>
      <CalimeroConnectButton />
      <button onClick={handleAction}>Call Contract</button>
    </div>
  );
}

// Wrap with provider
ReactDOM.createRoot(document.getElementById('root')!).render(
  <CalimeroProvider {...config}>
    <MyApp />
  </CalimeroProvider>
);
```

### For Package Developers (Working on DevTools)

#### 1. Setup
```bash
git clone <repo-url>
cd mero-devtools-js
pnpm install
```

#### 2. Build All Packages
```bash
pnpm build  # Runs build in all workspaces
```

#### 3. Build Individual Package
```bash
# abi-codegen
cd abi-codegen
pnpm build  # tsc + copy schema

# create-mero-app
cd create-mero-app
pnpm build  # tsc + postbuild script (creates cli.mjs)
```

#### 4. Run Tests
```bash
pnpm test  # All packages
cd abi-codegen && pnpm test  # Specific package
```

#### 5. Regenerate Example Client
```bash
cd codegen-example
pnpm run regenerate:abi-conformance
pnpm dev
```

#### 6. Test CLI Locally
```bash
# abi-codegen
cd abi-codegen
pnpm build
node dist/cli.js -i __fixtures__/abi_conformance.json -o tmp/test-output

# create-mero-app
cd create-mero-app
pnpm build
node dist/cli.mjs test-app
```

## CLI Reference

### calimero-abi-codegen

```bash
Options:
  -i, --input <file>           Input ABI JSON file (default: "abi.json")
  -o, --outDir <dir>          Output directory (default: "src")
  --client-name <Name>        Custom client class name (default: "Client")
  --name-from <path>          Derive client name from file path
  --import-path <path>        Custom import path for CalimeroApp/Context
                              (default: "@calimero-network/calimero-client")
  --validate                  Validate ABI manifest only (no codegen)
  -h, --help                  Display help message
```

### create-mero-app

```bash
Usage:
  npx create-mero-app [project-name]

  # Creates directory with project-name (or uses current directory)
  # Validates name as npm package name
  # Fails if directory exists and is not empty
```

## Build System Details

### abi-codegen
- TypeScript compilation to `dist/`
- Copy schema JSON to `dist/schema/`
- Export path configuration in package.json
- Prepack script ensures build before publish

### create-mero-app
- TypeScript compilation to `dist/esm/`
- Postbuild script: creates `dist/cli.mjs` with shebang from `dist/esm/index.js`
- Chmod 0755 on cli.mjs for executability
- Binary entry: `dist/cli.mjs`

### codegen-example
- Vite-based React app
- Predev hook: regenerates client from abi-codegen (uses local build)
- TypeScript type checking only (no output)

## Publishing & Release

### abi-codegen
- Uses **semantic-release** for automatic versioning
- Triggered by commits to main branch
- Conventional Commits for version determination:
  - `feat:` → minor bump
  - `fix:` → patch bump
  - `BREAKING CHANGE:` → major bump
- Publishes to npm with `@calimero-network` scope
- Requires `NPM_TOKEN` in GitHub secrets
- Updates CHANGELOG.md automatically

### create-mero-app
- Manual versioning (currently 0.1.0)
- Published to npm (no scope)
- Use `prepublishOnly` hook to build before publish

## Type System Mapping

**Schema Version**: `wasm-abi/1`
**Last Verified**: November 2025
**Source**: `abi-codegen/src/schema/wasm-abi-v1.schema.json`

> **Note**: This schema is based on the WASM-ABI v1 specification. For the latest mero-abi types from Calimero core, check: https://github.com/calimero-network/core (mero-abi crate). If new types are added to mero-abi, the schema and codegen will need to be updated accordingly.

### ABI Type → TypeScript Type

| ABI Type | TypeScript Type | Notes |
|----------|----------------|--------|
| `bool` | `boolean` | |
| `i32` | `number` | 32-bit signed integer |
| `i64` | `number` | 64-bit signed integer (may lose precision for very large values) |
| `u32` | `number` | 32-bit unsigned integer |
| `u64` | `number` | 64-bit unsigned integer (may lose precision) |
| `f32` | `number` | 32-bit floating point |
| `f64` | `number` | 64-bit floating point |
| `string` | `string` | UTF-8 string |
| `unit` | `void` | Empty/void type |
| `bytes` (variable) | `CalimeroBytes` | Variable-length byte arrays |
| `bytes` (fixed size) | `CalimeroBytes` | Fixed-size byte arrays (e.g., size: 32) |
| nullable field/param | `T \| null` | Optional values (via `nullable: true` flag) |
| `list<T>` | `T[]` | Arrays |
| `map<K, V>` | `Record<K, V>` | Objects (keys must be string-like) |
| `record` | `interface` | Named struct with fields |
| `variant` | Discriminated union | Tagged union with `name` and optional `payload` |
| `alias` | `type` | Type alias to another type |

### Types NOT Currently Supported

The following types are **not** supported in WASM-ABI v1 (but may be common in other systems):

- `i8` / `u8` - 8-bit integers
- `i16` / `u16` - 16-bit integers  
- `i128` / `u128` - 128-bit integers
- `char` - Single character
- `tuple` - Tuple types (use `record` instead)
- `enum` - Simple enums (use `variant` without payload instead)
- `set` - Set types (use `list` with unique constraint in logic)
- `result` - Result/Either types (handle via error fields in methods)

If users request these types, guide them to use the supported alternatives:
- For smaller integers (`i8`, `i16`, `u8`, `u16`), use `i32` or `u32`
- For tuples, use `record` with numbered fields
- For enums, use `variant` with no payload
- For Result types, use method-level `errors` field

## Error Handling

Current limitation (as of writing):
- Contract errors wrapped as `ExecutionError(Vec<u8>)` and stringified
- Error handling needs improvement (see calimero-network/core#1394)
- Best practice: use try-catch and check error messages

```typescript
try {
  const result = await client.mayFail({ flag: false });
} catch (error) {
  console.error('Contract error:', error);
  // Error is currently a string, not a typed error object
}
```

## Common Issues & Solutions

### Issue: "Module not found" when using generated client
**Solution**: Ensure `@calimero-network/calimero-client` is installed as a dependency.

### Issue: Type errors with CalimeroBytes
**Solution**: Use the helper methods:
```typescript
// ✅ Correct
const id = CalimeroBytes.fromHex('01'.repeat(32));

// ❌ Wrong
const id = new Uint8Array(32);
```

### Issue: Cannot find `dist/cli.js`
**Solution**: Run build first: `pnpm build` or `cd abi-codegen && pnpm build`

### Issue: create-mero-app fails with "Directory not empty"
**Solution**: Use an empty directory or remove existing contents first.

### Issue: Generated client has wrong import path
**Solution**: Use `--import-path` flag:
```bash
npx @calimero-network/abi-codegen -i abi.json -o src --import-path "@my-org/calimero-sdk"
```

## Testing

### abi-codegen Tests
- Location: `__tests__/`
- Framework: Vitest
- Fixtures: `__fixtures__/abi_conformance.json`, `__fixtures__/invalid_abi.json`
- Snapshots: `__tests__/__snapshots__/`
- Coverage: Parser, codegen, CLI, schema validation

### codegen-example
- Not automated tests, but comprehensive manual test suite
- Tests all type categories through real contract calls
- Useful for integration testing and validation

## Dependencies

### Key Production Dependencies
- `@calimero-network/calimero-client`: Calimero SDK for client apps
- `ajv` + `ajv-formats`: JSON schema validation
- `commander`: CLI argument parsing
- `kolorist`: Terminal colors
- `validate-npm-package-name`: Package name validation

### Development
- `typescript`: ^4.9.5 (abi-codegen), ^5.4.0 (create-mero-app)
- `vitest`: Testing framework
- `prettier`: Code formatting
- `semantic-release`: Automated publishing
- `vite`: Dev server for example

## File Structure Cheat Sheet

```
mero-devtools-js/
├── abi-codegen/                    # ABI → TypeScript codegen
│   ├── src/
│   │   ├── cli.ts                 # CLI entry point
│   │   ├── parse.ts               # ABI manifest parser
│   │   ├── model.ts               # Internal type models
│   │   ├── generate/
│   │   │   ├── types.ts           # Types generator
│   │   │   ├── client.ts          # Client generator
│   │   │   └── emit.ts            # Code emission utilities
│   │   ├── schema/
│   │   │   └── wasm-abi-v1.schema.json
│   │   └── utils/
│   ├── __fixtures__/              # Test ABI files
│   ├── __tests__/                 # Vitest tests
│   └── dist/                      # Build output (gitignored)
│
├── create-mero-app/               # App scaffolding tool
│   ├── src/
│   │   └── index.ts               # Main CLI logic
│   ├── scripts/
│   │   └── postbuild.mjs          # Build script for CLI
│   └── dist/                      # Build output (gitignored)
│       ├── esm/                   # TSC output
│       └── cli.mjs                # Final executable
│
├── codegen-example/               # Example React app
│   ├── src/
│   │   ├── main.tsx               # React app with test suite
│   │   └── generated/             # Generated client (gitignored)
│   │       └── abi-conformance/
│   │           ├── AbiConformanceClient.ts
│   │           └── types.ts
│   └── index.html
│
├── package.json                   # Root workspace config
├── pnpm-workspace.yaml            # Workspace definition
└── pnpm-lock.yaml                 # Lock file
```

## AI Assistant Guidelines

When helping users with this repository:

1. **Identify the user's goal**:
   - Building a Calimero app? → Guide to `create-mero-app` + `abi-codegen`
   - Working on devtools? → Guide to development workflow
   - Debugging generated code? → Explain type mappings and CalimeroBytes

2. **Common user flows**:
   - Scaffold app → Generate client → Integrate with React
   - Create ABI manifest → Validate → Generate → Test
   - Debug type errors → Check ABI manifest → Regenerate

3. **When debugging**:
   - Check if packages are built (`dist/` exists)
   - Verify ABI manifest is valid JSON and matches schema
   - Ensure dependencies are installed (especially `@calimero-network/calimero-client`)
   - Check import paths in generated code

4. **Code examples**:
   - Reference `codegen-example/src/main.tsx` for real-world usage
   - Show CalimeroBytes usage for byte arrays
   - Demonstrate variant helper functions
   - Include error handling patterns

5. **Version awareness**:
   - `abi-codegen` uses semantic-release (check CHANGELOG.md for latest)
   - `create-mero-app` manually versioned
   - Always suggest `@latest` for npx usage

## Additional Resources

- **Calimero Client Docs**: The `@calimero-network/calimero-client` package documentation
- **KV-Store Example**: https://github.com/calimero-network/kv-store (template used by create-mero-app)
- **WASM-ABI Schema**: `abi-codegen/src/schema/wasm-abi-v1.schema.json`
- **Example ABI**: `abi-codegen/__fixtures__/abi_conformance.json`
- **Generated Code Example**: Run `pnpm build` then check `codegen-example/src/generated/`

## Quick Commands Reference

```bash
# Install dependencies
pnpm install

# Build everything
pnpm build

# Test everything
pnpm test

# Format code
pnpm format

# Create new app (external usage)
npx create-mero-app@latest my-app

# Generate client (external usage)
npx @calimero-network/abi-codegen -i abi.json -o src/generated

# Validate ABI
npx @calimero-network/abi-codegen --validate -i abi.json

# Run example app
cd codegen-example && pnpm dev

# Test abi-codegen locally
cd abi-codegen && pnpm build && node dist/cli.js -i __fixtures__/abi_conformance.json -o tmp/test

# Test create-mero-app locally
cd create-mero-app && pnpm build && node dist/cli.mjs ../test-app
```

---

**Last Updated**: 2025-11-03
**Repository**: https://github.com/calimero-network/mero-devtools-js


