// TypeScript model for WASM-ABI v1 manifest
// Corresponds 1:1 to the JSON schema

export interface AbiManifest {
  schema_version: 'wasm-abi/1';
  types: Record<string, AbiTypeDef>;
  methods: AbiMethod[];
  events: AbiEvent[];
  state_root?: string;
  // AppState::SCHEMA_VERSION of the build (default 1). Absent only on manifests
  // emitted by SDKs predating this field.
  state_version?: number;
  // Declared migration edges, one per retained from->from+1 hop.
  migrations?: AbiMigrationEdge[];
}

// A single declared migration edge: invoking `method` carries state from
// `fromVersion` to `fromVersion + 1`. Note the camelCase wire key `fromVersion`.
export interface AbiMigrationEdge {
  method: string;
  fromVersion: number;
}

// Type references can be either inline types or references to named types
export type AbiTypeRef =
  | { $ref: string }
  | AbiScalar
  | AbiBytesVar
  | AbiBytesFixed
  | AbiList
  | AbiMap
  | AbiRecord
  | AbiTuple;

// Scalar types
export interface AbiScalar {
  kind:
    | 'bool'
    | 'i32'
    | 'i64'
    | 'u32'
    | 'u64'
    | 'f32'
    | 'f64'
    | 'string'
    | 'unit';
}

// Bytes types - discriminated union for fixed vs variable.
// `encoding` is an optional free-form hint (matches core's BytesType); current
// SDKs omit it entirely.
export interface AbiBytesVar {
  kind: 'bytes';
  encoding?: string;
  // No size property for variable bytes
}

export interface AbiBytesFixed {
  kind: 'bytes';
  size: number; // minimum: 1
  encoding?: string;
}

// Collection types
export interface AbiList {
  kind: 'list';
  items: AbiTypeRef;
  crdt_type?: string;
}

export interface AbiMap {
  kind: 'map';
  key: AbiTypeRef;
  value: AbiTypeRef;
  crdt_type?: string;
}

export interface AbiRecord {
  kind: 'record';
  fields: AbiField[];
  crdt_type?: string;
  inner_type?: AbiTypeRef;
}

export interface AbiTuple {
  kind: 'tuple';
  elements: AbiTypeRef[];
}

// Field definition
export interface AbiField {
  name: string;
  type: AbiTypeRef;
  nullable?: boolean;
}

// Variant definition
export interface AbiVariant {
  name: string;
  code?: string;
  payload?: AbiTypeRef;
}

// Alias type definition
export interface AbiAlias {
  kind: 'alias';
  target: AbiTypeRef;
}

// Type definitions (what goes in the types object)
export type AbiTypeDef =
  | AbiRecord
  | AbiVariantDef
  | AbiBytesVar
  | AbiBytesFixed
  | AbiAlias;

export interface AbiVariantDef {
  kind: 'variant';
  variants: AbiVariant[];
}

// Method definition
export interface AbiMethod {
  name: string;
  params: AbiParameter[];
  returns?: AbiTypeRef;
  returns_nullable?: boolean;
  errors?: AbiError[];
  // Read/write intent declared by the app author. Absent on modules compiled
  // before this field existed; the node then treats the method as write intent.
  intent?: 'read_only' | 'mutating' | 'unspecified';
  // Cross-context entry point declared via #[app::xcall]. Absent/false on
  // modules compiled before this field existed.
  xcall_callable?: boolean;
}

// Parameter definition
export interface AbiParameter {
  name: string;
  type: AbiTypeRef;
  nullable?: boolean;
}

// Error definition
export interface AbiError {
  code: string;
  payload?: AbiTypeRef;
}

// Event definition
export interface AbiEvent {
  name: string;
  payload?: AbiTypeRef;
}
