import { AbiSchema } from './types';
export declare class AbiCodegen {
    private typeGenerator;
    private clientGenerator;
    constructor();
    /**
     * Loads and validates an ABI schema from a JSON file
     */
    loadAbiSchema(filePath: string): AbiSchema;
    /**
     * Generates TypeScript files from an ABI schema
     */
    generateFiles(abi: AbiSchema, outputDir: string): void;
    /**
     * Main entry point for code generation
     */
    generate(inputFile: string, outputDir: string): void;
}
//# sourceMappingURL=codegen.d.ts.map