/**
 * Helper functions for emitting generated code
 */
/**
 * Generate a file banner for generated files
 */
export declare function generateFileBanner(): string;
/**
 * Format a TypeScript identifier to be safe for use in code
 * @param name - The name to format
 * @returns A safe TypeScript identifier
 */
export declare function formatIdentifier(name: string): string;
/**
 * Convert a string to PascalCase for type names
 * @param str - The string to convert
 * @returns PascalCase string
 */
export declare function toPascalCase(str: string): string;
/**
 * Convert a string to camelCase for method names
 * @param str - The string to convert
 * @returns camelCase string
 */
export declare function toCamelCase(str: string): string;
/**
 * Derive a client class name from a file path
 * @param p - The file path to derive the name from
 * @returns The derived client class name
 */
export declare function deriveClientNameFromPath(p: string): string;
//# sourceMappingURL=emit.d.ts.map