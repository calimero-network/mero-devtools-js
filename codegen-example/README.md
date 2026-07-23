# ABI Conformance Example

This example demonstrates the Calimero SDK's generated client with React hooks for ABI conformance testing.

## Setup

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Configure environment** (optional):
   ```bash
   cp .env.example .env
   # Edit .env with your Calimero app details
   ```

3. **Generate client code**:
   ```bash
   npm run regenerate:abi-conformance
   ```

## Development

```bash
npm run dev
```

The `predev` script automatically regenerates the client code.

## Generated Code

The generator writes a single file to `src/generated/abi-conformance/`:
- `AbiConformanceClient.ts` — the client class plus all TypeScript type
  definitions (types are embedded in this one file; there is no separate
  `types.ts` or barrel `index.ts`).

The client name `AbiConformanceClient` is derived from the input fixture
filename (`abi_conformance.json`).

## ABI Conformance Tests

Tests comprehensive WASM ABI functionality:
- Basic data types (bool, i32, u32, string, etc.)
- Complex types (records, lists, maps)
- Byte arrays (CalimeroBytes)
- Optional values
- Error handling
- Event handling

## Environment Variables

- `VITE_CALIMERO_CLIENT_APP_ID`: Your Calimero client application ID
- `VITE_CALIMERO_APP_PATH`: Path to your Calimero application WASM file
