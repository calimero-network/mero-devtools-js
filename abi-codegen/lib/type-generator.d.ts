import { AbiType } from './types';
export declare class TypeGenerator {
    /**
     * Converts a Rust type to TypeScript type
     */
    convertType(rustType: string): string;
    /**
     * Generates TypeScript interface for function parameters
     */
    generateParamsInterface(_functionName: string, params: Record<string, string>): string;
    /**
     * Generates TypeScript type for function return value
     */
    generateReturnType(returns: AbiType | null): string;
    /**
     * Generates error code union type
     */
    generateErrorCodeType(_functionName: string, errors: string[]): string;
    /**
     * Generates the complete types.ts content
     */
    generateTypesFile(abi: {
        schema: string;
        functions: Record<string, {
            params: Record<string, string>;
            returns: AbiType | null;
            errors: string[];
        }>;
    }): string;
    /**
     * Converts snake_case to PascalCase
     */
    private toPascalCase;
}
//# sourceMappingURL=type-generator.d.ts.map