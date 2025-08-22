import { AbiType } from './types';
export declare class ClientGenerator {
    /**
     * Generates the complete client.ts content
     */
    generateClientFile(abi: {
        schema: string;
        functions: Record<string, {
            params: Record<string, string>;
            returns: AbiType | null;
            errors: string[];
        }>;
    }): string;
    /**
     * Converts snake_case to camelCase
     */
    private toCamelCase;
    /**
     * Converts snake_case to PascalCase
     */
    private toPascalCase;
}
//# sourceMappingURL=client-generator.d.ts.map