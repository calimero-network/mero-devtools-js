## [0.2.1](https://github.com/calimero-network/mero-devtools-js/compare/v0.2.0...v0.2.1) (2025-10-03)


### Bug Fixes

* bump version in package.json ([ac22a9b](https://github.com/calimero-network/mero-devtools-js/commit/ac22a9bdf4b8a4a95fbc274b609d42cdf607279a))
* change release ([a1a41e7](https://github.com/calimero-network/mero-devtools-js/commit/a1a41e7d7017857cfe29671d27b873127bcf14ff))
* remove duplicated types ([d5f3d57](https://github.com/calimero-network/mero-devtools-js/commit/d5f3d5728763d53f4a08d56f07e5c823eae6be34))

# [0.2.0](https://github.com/calimero-network/mero-devtools-js/compare/v0.1.0...v0.2.0) (2025-09-17)


### Bug Fixes

* **abi-codegen:** include schema file in published package and fix path ([6823c52](https://github.com/calimero-network/mero-devtools-js/commit/6823c52ca872b77a83a1484a320282583c813281))


### Features

* added first simple version of create-mero-app which just clones the kv-store repo without the git files ([1a85c53](https://github.com/calimero-network/mero-devtools-js/commit/1a85c5388f3f661088a265de07b4fa1be1977b79))
* **create-mero-app:** add CLI to scaffold from calimero-network/kv-store; exclude git files; publish config ([246342c](https://github.com/calimero-network/mero-devtools-js/commit/246342c4e604a1adcb72c12c8c6fac306747b7ea))

# [0.1.0](https://github.com/calimero-network/mero-devtools-js/compare/v0.0.0...v0.1.0) (2025-08-22)


### Bug Fixes

* configure semantic-release to avoid version command conflicts ([29578af](https://github.com/calimero-network/mero-devtools-js/commit/29578af3fde9978b7064eda9f7071a6f7dcfe7d9))
* remove @semantic-release/npm plugin entirely to avoid version commands ([0fd7901](https://github.com/calimero-network/mero-devtools-js/commit/0fd79017fff8f3d68396c9101adb9778cbd3ff5b))
* remove npm config command from CI to avoid workspace conflicts ([6b52a17](https://github.com/calimero-network/mero-devtools-js/commit/6b52a17bf120213668cc9798d764cfc4e41bc432))
* replace @semantic-release/npm with semantic-release-pnpm to fix workspace compatibility ([7297999](https://github.com/calimero-network/mero-devtools-js/commit/7297999420d15031111bec5896988842e6118219))
* update CI/CD workflow to use pnpm instead of npm ([ff4b68f](https://github.com/calimero-network/mero-devtools-js/commit/ff4b68f07626cf5c6914f9e91cf98f15be8859b7))
* update tests to match current code generation format ([392be7d](https://github.com/calimero-network/mero-devtools-js/commit/392be7db2da57bffd5abe403b433466a472b63b2))
* use --no-frozen-lockfile for CI/CD compatibility ([10865dc](https://github.com/calimero-network/mero-devtools-js/commit/10865dc6b37c33b3cbc73e318121d2f79acfa1b1))
* use simple semantic-release config like calimero-client-js ([6665b78](https://github.com/calimero-network/mero-devtools-js/commit/6665b7819e62763e32f96f0c86d4b17af38c0b51))


### Features

* add npm publishing via @semantic-release/exec plugin ([7a35aca](https://github.com/calimero-network/mero-devtools-js/commit/7a35aca957744fbfdf9628252386a11ab6ab08f7))
* setup npm distribution with semantic releases ([37829b4](https://github.com/calimero-network/mero-devtools-js/commit/37829b42439dc12c53dfa3e97f91549eb18a1d6e))

# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Initial release of ABI codegen tool
- WASM-ABI v1 parser and code generator
- CLI tool for generating TypeScript clients
- Programmatic API for code generation
- Support for CalimeroBytes type handling
- Comprehensive test suite
