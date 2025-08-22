# Calimero ABI Codegen

WASM-ABI v1 parser and code generator for Calimero applications. This tool generates TypeScript client code and type definitions from ABI manifest files.

## 📦 Packages

- **`abi-codegen`**: The main package that generates TypeScript clients from ABI manifests
- **`codegen-example`**: Example React application demonstrating the generated client

## 🚀 Quick Start

### For External Users

```bash
# Install the package
npm install @calimero/abi-codegen

# Use the CLI tool
npx calimero-abi-codegen -i abi.json -o src

# Use programmatically
import { loadAbiManifestFromFile } from '@calimero/abi-codegen/parse';
```

### For Developers

```bash
# Clone and setup
git clone <repo-url>
cd calimero-abi-codegen
pnpm install

# Generate example client from local code
cd codegen-example
npm run regenerate:abi-conformance
npm run dev
```

## 📋 CLI Usage

```bash
# Basic usage
npx calimero-abi-codegen -i abi.json -o src

# With custom client name
npx calimero-abi-codegen -i abi.json -o src --client-name MyClient

# Validate ABI manifest only
npx calimero-abi-codegen --validate -i abi.json

# Derive client name from WASM file
npx calimero-abi-codegen -i abi.json -o src --name-from kv_store.wasm
```

### Options

- `-i, --input <file>` - Input ABI JSON file (default: abi.json)
- `-o, --outDir <dir>` - Output directory for generated files (default: src)
- `--client-name <Name>` - Custom client class name (default: Client)
- `--name-from <path>` - Derive client name from file path (e.g., wasm file)
- `--import-path <path>` - Custom import path for CalimeroApp and Context (default: @calimero-network/calimero-client)
- `--validate` - Validate ABI manifest only (no code generation)
- `-h, --help` - Show help message

## 🔧 Development

### Local Development

The example project uses local code for development and testing:

```bash
# Build the abi-codegen package
cd abi-codegen
npm run build

# Generate example client
cd ../codegen-example
npm run regenerate:abi-conformance
```

### Testing

```bash
# Run all tests
pnpm test

# Test specific package
cd abi-codegen
npm run test
npm run validate:abi
npm run generate:example
```

## 📝 Commit Convention

This project uses [Conventional Commits](https://www.conventionalcommits.org/) for automatic versioning:

- **feat**: New features (minor version bump)
- **fix**: Bug fixes (patch version bump)
- **BREAKING CHANGE**: Breaking changes (major version bump)
- **docs**, **style**, **refactor**, **perf**, **test**, **build**, **ci**, **chore**: No version bump

### Examples

```bash
git commit -m "feat: add support for custom client names"
git commit -m "fix: handle empty arrays in type generation"
git commit -m "docs: update README with usage examples"
```

## 🚀 Publishing

This project uses **semantic-release** for automatic versioning and publishing. Releases are triggered automatically when commits are pushed to the main branch.

### Prerequisites

1. **GitHub Secrets**: Set `NPM_TOKEN` in repository secrets
2. **npm Access**: Ensure access to the `@calimero` organization

### Process

1. **Make changes** and commit with conventional commit messages
2. **Push to main branch** or merge a PR
3. **CI/CD pipeline** automatically:
   - Runs tests
   - Analyzes commits
   - Determines version
   - Publishes to npm
   - Creates GitHub release
   - Updates CHANGELOG.md

### Manual Release (if needed)

```bash
cd abi-codegen
npm run release
```

## 📦 Package Structure

The published package includes:

- **CLI binary**: `calimero-abi-codegen` executable
- **Library exports**: Functions for programmatic use
- **TypeScript types**: Full type definitions
- **Schema**: WASM-ABI v1 schema for validation
- **Documentation**: README.md and CHANGELOG.md

## 🎯 Generated Files

The tool generates two main files:

1. **types.ts** - TypeScript type definitions for all ABI types, methods, and events
2. **{ClientName}.ts** - The main client class with methods for all ABI functions

## 📚 ABI Manifest Format

The tool expects a WASM-ABI v1 manifest in JSON format. See the schema at `abi-codegen/schema/wasm-abi-v1.schema.json` for the complete specification.

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make changes with conventional commit messages
4. Run tests: `pnpm test`
5. Submit a pull request

## 📄 License

MIT 