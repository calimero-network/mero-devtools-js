// Type mapping from Rust to TypeScript
export const RUST_TO_TS_TYPES = {
    // Primitives
    'bool': 'boolean',
    'String': 'string',
    // Unsigned integers
    'u8': 'number',
    'u16': 'number',
    'u32': 'number',
    'u64': 'number',
    'u128': 'string',
    // Signed integers
    'i8': 'number',
    'i16': 'number',
    'i32': 'number',
    'i64': 'number',
    'i128': 'string',
    // Special types
    'Vec<u8>': 'string', // hex string with 0x prefix
};
// Type guards and utilities
export function isPrimitiveType(type) {
    return type in RUST_TO_TS_TYPES;
}
export function isOptionType(type) {
    return type.startsWith('Option<') && type.endsWith('>');
}
export function isVecType(type) {
    return type.startsWith('Vec<') && type.endsWith('>');
}
export function getOptionInnerType(type) {
    if (!isOptionType(type)) {
        throw new Error(`Not an Option type: ${type}`);
    }
    return type.slice(7, -1); // Remove "Option<" and ">"
}
export function getVecInnerType(type) {
    if (!isVecType(type)) {
        throw new Error(`Not a Vec type: ${type}`);
    }
    return type.slice(4, -1); // Remove "Vec<" and ">"
}
//# sourceMappingURL=types.js.map