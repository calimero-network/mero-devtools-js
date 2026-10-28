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
`@calimero-network/mero-react`), `--target <ts|swift|kotlin>` (default `ts`),
`--package <name>` (Kotlin only), `--validate`,
`-h, --help`. Full details in the
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
for the full surface (`parseAbiManifest` and the naming utilities
in `generate/emit`).

## Generated Files

The CLI writes a **single** file, `{ClientName}.ts` (or `.swift` / `.kt` for the
native targets), into the output directory.
Type definitions and the client class live together in that one file — there is
no separate `types.ts` module.

## Swift and Kotlin clients

`--target swift` and `--target kotlin` generate a native client for mobile apps
instead of the TypeScript one. Each is one self-contained file with no SDK
dependency: the types, the client, and a `ContextContractCalling` transport the
app implements over its own node or relay connection.

```bash
# Writes Sources/Generated/ForumClient.swift
npx calimero-abi-codegen -i logic/res/abi.json -o Sources/Generated \
  --target swift --client-name ForumClient

# Writes app/src/main/kotlin/network/calimero/forum/ForumClient.kt
npx calimero-abi-codegen -i logic/res/abi.json \
  -o app/src/main/kotlin/network/calimero/forum \
  --target kotlin --package network.calimero.forum --client-name ForumClient
```

`--target` is `ts` (default, unchanged), `swift` or `kotlin`; `--package` sets the
Kotlin file's package (no `package` line without it). `--import-path` applies to
`ts` only.

What is generated:

- **Swift**: `Codable, Sendable, Equatable` structs and enums for every ABI type,
  and a `struct {ClientName}` with one `async throws` function per method.
- **Kotlin**: kotlinx.serialization `@Serializable` data classes, enum classes
  and sealed classes, and a `class {ClientName}` with one `suspend` function per
  method. Properties are camelCase with `@SerialName` carrying the wire name.
  Needs the `org.jetbrains.kotlin.plugin.serialization` plugin and
  `kotlinx-serialization-json`.

The transport is one call per route:

```swift
public protocol ContextContractCalling: Sendable {
    func query(method: String, argsJSON: Data) async throws -> Data
    func execute(method: String, argsJSON: Data) async throws -> Data
}
```

```kotlin
interface ContextContractCalling {
    suspend fun query(method: String, argsJson: String): String
    suspend fun execute(method: String, argsJson: String): String
}
```

A method whose ABI `intent` is `read_only` is a view and goes to `query`; every
other method (`mutating`, `unspecified`, or no intent) goes to `execute`, as the
node treats it. Each function's doc comment says which.

The wire shape is the TypeScript client's: integers are JSON numbers, bytes are
arrays of numbers (`[UInt8]` / `List<UByte>`), tuples are arrays
(`ContractTuple2<A, B>`, ...), and enums follow serde's tagging (bare name,
`{ "Variant": payload }`, internally/adjacently tagged, or untagged). A map key
that is not a string is typed `String`, since JSON keys are. One difference:
an optional argument left `nil`/`null` is omitted from the args object rather
than sent as `null`; the contract reads a missing `Option` as `None`.

Generate one client per Swift module or Kotlin package: the transport and
helper types are declared in every generated file.

With the native SDKs, pass `--transport-import` to use their
`ContextContractCalling` instead, so the SDK's bound contract is the transport
with no adapter: `--transport-import MeroKit` (Swift) or
`--transport-import com.calimero.mero.app.ContextContractCalling` (Kotlin).

```swift
let forum = ForumClient(transport: contract.bound(to: contextId))
```

## Examples

See the [codegen-example](../codegen-example) for a complete React example.

## Development

```bash
npm install
npm run build
npm run test
```
