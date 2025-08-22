import { AbiManifest } from '../model.js';
/**
 * Generate a typed client from a WASM-ABI v1 manifest
 * @param manifest - The parsed ABI manifest
 * @param clientName - The name of the generated client class
 * @returns Generated TypeScript client as a string
 */
export declare function generateClient(manifest: AbiManifest, clientName?: string, importPath?: string): string;
//# sourceMappingURL=client.d.ts.map