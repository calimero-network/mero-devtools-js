export interface AbiSchema {
    schema: string;
    functions: Record<string, AbiFunction>;
}
export interface AbiFunction {
    params: Record<string, string>;
    returns: AbiType | null;
    errors: string[];
}
export type AbiType = string | Record<string, unknown> | unknown[] | null;
export interface CalimeroTransport {
    call<T>(method: string, params: Record<string, unknown>): Promise<T>;
    subscribe<T>(method: string, params: Record<string, unknown>, callback: (data: T) => void): () => void;
}
export interface CalimeroAbiError {
    code: string;
    data?: unknown;
}
export declare const RUST_TO_TS_TYPES: Record<string, string>;
export declare function isPrimitiveType(type: string): boolean;
export declare function isOptionType(type: string): boolean;
export declare function isVecType(type: string): boolean;
export declare function getOptionInnerType(type: string): string;
export declare function getVecInnerType(type: string): string;
//# sourceMappingURL=types.d.ts.map