export interface AbiManifest {
    schema_version: 'wasm-abi/1';
    types: Record<string, AbiTypeDef>;
    methods: AbiMethod[];
    events: AbiEvent[];
}
export type AbiTypeRef = {
    $ref: string;
} | AbiScalar | AbiBytesVar | AbiBytesFixed | AbiList | AbiMap | AbiRecord;
export interface AbiScalar {
    kind: 'bool' | 'i32' | 'i64' | 'u32' | 'u64' | 'f32' | 'f64' | 'string' | 'unit';
}
export interface AbiBytesVar {
    kind: 'bytes';
    encoding: 'hex';
}
export interface AbiBytesFixed {
    kind: 'bytes';
    size: number;
    encoding: 'hex';
}
export interface AbiList {
    kind: 'list';
    items: AbiTypeRef;
}
export interface AbiMap {
    kind: 'map';
    key: AbiTypeRef;
    value: AbiTypeRef;
}
export interface AbiRecord {
    kind: 'record';
    fields: AbiField[];
}
export interface AbiField {
    name: string;
    type: AbiTypeRef;
    nullable?: boolean;
}
export interface AbiVariant {
    name: string;
    code?: string;
    payload?: AbiTypeRef;
}
export interface AbiAlias {
    kind: 'alias';
    target: AbiTypeRef;
}
export type AbiTypeDef = AbiRecord | AbiVariantDef | AbiBytesVar | AbiBytesFixed | AbiAlias;
export interface AbiVariantDef {
    kind: 'variant';
    variants: AbiVariant[];
}
export interface AbiMethod {
    name: string;
    params: AbiParameter[];
    returns?: AbiTypeRef;
    returns_nullable?: boolean;
    errors?: AbiError[];
}
export interface AbiParameter {
    name: string;
    type: AbiTypeRef;
    nullable?: boolean;
}
export interface AbiError {
    code: string;
    payload?: AbiTypeRef;
}
export interface AbiEvent {
    name: string;
    payload?: AbiTypeRef;
}
//# sourceMappingURL=model.d.ts.map