import { AbiManifest } from './model.js';
/**
 * Parse and validate a WASM-ABI v1 manifest
 * @param json - The JSON object to parse
 * @returns A frozen AbiManifest object
 * @throws Error if validation fails
 */
export declare function parseAbiManifest(json: unknown): AbiManifest;
/**
 * Load and parse a WASM-ABI v1 manifest from a file
 * @param path - Path to the JSON file
 * @returns A frozen AbiManifest object
 * @throws Error if file cannot be read or validation fails
 */
export declare function loadAbiManifestFromFile(path: string): AbiManifest;
//# sourceMappingURL=parse.d.ts.map