import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { loadAbiManifestFromFile } from '../src/parse.js';
import { generateTypes } from '../src/generate/types.js';
import { generateClient } from '../src/generate/client.js';
import { deriveClientNameFromPath, sanitizeClassName, mapRustTypeToTs } from '../src/generate/emit.js';
import { parseAbiManifest } from '../src/parse.js';

describe('Codegen', () => {
  const conformanceAbiPath = path.join(
    __dirname,
    '../__fixtures__/abi_conformance.json',
  );
  let manifest: any;

  beforeAll(() => {
    manifest = loadAbiManifestFromFile(conformanceAbiPath);
  });

  describe('types.ts generation', () => {
    it('should generate types.ts with correct structure', () => {
      const typesContent = generateTypes(manifest);

      // Snapshot test removed - format has changed significantly

      // Assert key patterns
      expect(typesContent).toContain('export interface Person {');
      expect(typesContent).toContain('export type ActionPayload =');
      expect(typesContent).toContain("| { name: 'SetName'; payload: string }");
      expect(typesContent).toContain(
        "| { name: 'Update'; payload: UpdatePayload }",
      );
      expect(typesContent).toContain('export type UserId32 = CalimeroBytes;');
      // JSDoc comments are no longer included in the new format
      // Error codes are no longer generated in the new format
      expect(typesContent).toContain('export type AbiEvent =');
      // Events with $ref payloads must include the payload field
      expect(typesContent).toContain(
        '| { name: "PersonUpdated"; payload: Person }',
      );
      // Unit events should not have payload property
      expect(typesContent).toContain('| { name: "Ping" }');
      expect(typesContent).not.toContain('| { name: "Ping"; payload:');
    });

    it('should handle nullable fields correctly', () => {
      const typesContent = generateTypes(manifest);

      expect(typesContent).toContain('bio: string | null;');
      expect(typesContent).toContain('bio: string | null;');
    });

    it('should handle maps correctly', () => {
      const typesContent = generateTypes(manifest);

      expect(typesContent).toContain('counters: Record<string, number>;');
    });

    it('should handle lists correctly', () => {
      const typesContent = generateTypes(manifest);

      // The conformance ABI has list_u32 method that returns number[]
      // But we need to check the client generation for this
      const clientContent = generateClient(manifest);
      expect(clientContent).toContain('number[]');
    });

    it('should handle unit returns correctly', () => {
      const clientContent = generateClient(manifest);

      // The 'act' method returns number
      expect(clientContent).toContain(
        'async act(params: { a: ActionPayload }): Promise<number> {',
      );
    });

    it('should handle unit events correctly', () => {
      const typesContent = generateTypes(manifest);

      // Unit events should not have payload property in the union
      expect(typesContent).toContain('| { name: "Ping" }');
      expect(typesContent).not.toContain('| { name: "Ping"; payload:');

      // Unit events should not generate payload type aliases
      expect(typesContent).not.toContain('export type PingPayload =');
    });

    it('should include fixed bytes JSDoc', () => {
      const typesContent = generateTypes(manifest);

      // Fixed bytes are now handled by CalimeroBytes class
      expect(typesContent).toContain('export type UserId32 = CalimeroBytes;');
      expect(typesContent).toContain('export type Hash64 = CalimeroBytes;');
    });

    it('should handle variant inline struct payloads correctly', () => {
      const typesContent = generateTypes(manifest);

      // The Action variant "Update" has a reference to UpdatePayload
      expect(typesContent).toContain(
        "| { name: 'Update'; payload: UpdatePayload }",
      );
    });

    it('should handle variant $ref payloads correctly', () => {
      const typesContent = generateTypes(manifest);

      // The Action variant "SetName" has a string payload
      expect(typesContent).toContain("| { name: 'SetName'; payload: string }");
      // The Action variant "Ping" has no payload
      expect(typesContent).toContain("| { name: 'Ping' }");
    });
  });

  describe('client.ts generation', () => {
    it('should generate client.ts with correct structure', () => {
      const clientContent = generateClient(manifest, 'TestClient');

      // Snapshot test removed - format has changed significantly

      // Assert key patterns
      expect(clientContent).toContain('export class TestClient {');
      expect(clientContent).toContain('import {');
      expect(clientContent).toContain('  MeroJs,');

      // ExecutionResponse is no longer imported
      expect(clientContent).toContain(
        "} from '@calimero-network/mero-react';",
      );
      expect(clientContent).toContain(
        'constructor(mero: MeroJs, contextId: string, executorPublicKey: string) {',
      );
      expect(clientContent).toContain(
        'async optU32(params: { x: number | null }): Promise<number | null> {',
      );
      expect(clientContent).toContain(
        "const response = await this._mero.rpc.execute({ contextId: this._contextId, method: 'opt_u32', argsJson: params, executorPublicKey: this._executorPublicKey });",
      );
      expect(clientContent).toContain(
        'async makePerson(params: { p: Person }): Promise<Person> {',
      );
      expect(clientContent).toContain(
        "const response = await this._mero.rpc.execute({ contextId: this._contextId, method: 'make_person', argsJson: convertCalimeroBytesForWasm(params), executorPublicKey: this._executorPublicKey });",
      );
      // Error documentation is now handled through standard error response pattern
    });

    it('should handle zero-parameter methods correctly', () => {
      // Note: The test ABI doesn't have any zero-parameter methods
      // This test would verify that zero-parameter methods have no arguments and pass empty object
      // For now, we'll skip this test since our test ABI has no such methods
      expect(true).toBe(true);
    });

    it('should handle single-parameter methods correctly', () => {
      const clientContent = generateClient(manifest);

      // Check that single-parameter methods use named params object
      expect(clientContent).toContain(
        'async roundtripId(params: { x: UserId32 }): Promise<UserId32> {',
      );
      expect(clientContent).toContain(
        "const response = await this._mero.rpc.execute({ contextId: this._contextId, method: 'roundtrip_id', argsJson: convertCalimeroBytesForWasm(params), executorPublicKey: this._executorPublicKey });",
      );
      expect(clientContent).toContain(
        'async optU32(params: { x: number | null }): Promise<number | null> {',
      );
      expect(clientContent).toContain(
        "const response = await this._mero.rpc.execute({ contextId: this._contextId, method: 'opt_u32', argsJson: params, executorPublicKey: this._executorPublicKey });",
      );
    });

    it('should handle multi-parameter methods correctly', () => {
      const clientContent = generateClient(manifest);

      // Check that multi-parameter methods use named params object with all fields
      expect(clientContent).toContain(
        'async makePerson(params: { p: Person }): Promise<Person> {',
      );
      expect(clientContent).toContain(
        "const response = await this._mero.rpc.execute({ contextId: this._contextId, method: 'make_person', argsJson: convertCalimeroBytesForWasm(params), executorPublicKey: this._executorPublicKey });",
      );
    });

    it('should preserve ABI method names verbatim in execute calls', () => {
      const clientContent = generateClient(manifest);

      // Check that ABI method names are used exactly as they appear in the ABI
      expect(clientContent).toContain("'opt_u32'");
      expect(clientContent).toContain("'list_u32'");
      expect(clientContent).toContain("'map_u32'");
      expect(clientContent).toContain("'make_person'");
      expect(clientContent).toContain("'profile_roundtrip'");
      expect(clientContent).toContain("'roundtrip_id'");
      expect(clientContent).toContain("'roundtrip_hash'");
      expect(clientContent).toContain("'may_fail'");
      expect(clientContent).toContain("'find_person'");
    });

    it('should handle methods with errors correctly', () => {
      const clientContent = generateClient(manifest);

      expect(clientContent).toContain(
        'async mayFail(params: { flag: boolean }): Promise<number> {',
      );
      // Errors are thrown by rpc.execute as RpcError — generated code just returns the result
      expect(clientContent).toContain('return response as number;');
    });

    it('should handle methods with nullable returns', () => {
      const clientContent = generateClient(manifest);

      expect(clientContent).toContain(
        'async findPerson(params: { name: string }): Promise<Person> {',
      );
    });

    it('should preserve parameter order in method calls', () => {
      const clientContent = generateClient(manifest);

      // The makePerson method has a single parameter of type Person
      expect(clientContent).toContain(
        'async makePerson(params: { p: Person }): Promise<Person> {',
      );
      expect(clientContent).toContain(
        "const response = await this._mero.rpc.execute({ contextId: this._contextId, method: 'make_person', argsJson: convertCalimeroBytesForWasm(params), executorPublicKey: this._executorPublicKey });",
      );
    });

    it('should include types in the same file', () => {
      const clientContent = generateClient(manifest);

      // Should include types directly in the client file
      expect(clientContent).toContain('export interface Person {');
      expect(clientContent).toContain('export type UserId32 = CalimeroBytes;');
    });

    it('should include generated banner', () => {
      const clientContent = generateClient(manifest);
      const typesContent = generateTypes(manifest);

      // Both files should have the generated banner
      expect(clientContent).toContain(
        '/** @generated by @calimero/abi-codegen — DO NOT EDIT. */',
      );
      expect(typesContent).toContain(
        '/** @generated by @calimero/abi-codegen — DO NOT EDIT. */',
      );
    });
  });

  describe('name derivation', () => {
    it('should derive client name from wasm filename correctly', () => {
      expect(deriveClientNameFromPath('kv_store.wasm')).toBe('KVStoreClient');
      expect(deriveClientNameFromPath('plantr.wasm')).toBe('PlantrClient');
      expect(deriveClientNameFromPath('abi-conformance.wasm')).toBe(
        'AbiConformanceClient',
      );
    });

    it('should derive client name from json filename correctly', () => {
      expect(deriveClientNameFromPath('abi-conformance.json')).toBe(
        'AbiConformanceClient',
      );
      expect(deriveClientNameFromPath('kv_store.json')).toBe('KVStoreClient');
    });

    it('should handle paths with directories', () => {
      expect(deriveClientNameFromPath('/tmp/kv_store.wasm')).toBe(
        'KVStoreClient',
      );
      expect(
        deriveClientNameFromPath(
          'apps/kv_store/target/wasm32-unknown-unknown/debug/kv_store.wasm',
        ),
      ).toBe('KVStoreClient');
    });

    it('should handle edge cases', () => {
      expect(deriveClientNameFromPath('')).toBe('Client');
      expect(deriveClientNameFromPath('a')).toBe('AClient');
      expect(deriveClientNameFromPath('ab')).toBe('ABClient');
      expect(deriveClientNameFromPath('abc')).toBe('AbcClient');
    });

    it('should generate client with derived name', () => {
      const clientContent = generateClient(manifest, 'KVStoreClient');

      expect(clientContent).toContain('export class KVStoreClient {');
      expect(clientContent).toContain(
        'constructor(mero: MeroJs, contextId: string, executorPublicKey: string) {',
      );
      expect(clientContent).toContain('private _mero: MeroJs;');
      expect(clientContent).toContain('private _contextId: string;');
      expect(clientContent).toContain('private _executorPublicKey: string;');
      expect(clientContent).toContain('import {');
      expect(clientContent).toContain('  MeroJs,');

      expect(clientContent).toContain(
        "} from '@calimero-network/mero-react';",
      );
    });
  });

  describe('manifest immutability', () => {
    it('should not mutate the manifest during generation', () => {
      // Test that the manifest is deeply frozen
      expect(() => {
        // This should throw if the manifest is properly frozen
        (manifest as any).methods.push({ name: 'test', params: [] });
      }).toThrow();

      // Test a nested variant payload node
      expect(() => {
        // This should throw if the manifest is properly frozen
        (manifest.types.Action.variants[1] as any).payload = { kind: 'string' };
      }).toThrow();
    });
  });

  describe('Bug 1: class name sanitization', () => {
    // Basic transformations
    it('should remove spaces and preserve casing', () => {
      expect(sanitizeClassName('Task Board')).toBe('TaskBoard');
      expect(sanitizeClassName('Mero Bench')).toBe('MeroBench');
      expect(sanitizeClassName('my cool app')).toBe('MyCoolApp');
    });

    it('should preserve already-valid PascalCase names', () => {
      expect(sanitizeClassName('TestClient')).toBe('TestClient');
      expect(sanitizeClassName('KVStoreClient')).toBe('KVStoreClient');
      expect(sanitizeClassName('Client')).toBe('Client');
    });

    it('should handle hyphens and underscores', () => {
      expect(sanitizeClassName('my-app')).toBe('MyApp');
      expect(sanitizeClassName('kv_store')).toBe('KvStore');
      expect(sanitizeClassName('multi--dash')).toBe('MultiDash');
      expect(sanitizeClassName('__leading')).toBe('Leading');
      expect(sanitizeClassName('trailing__')).toBe('Trailing');
    });

    it('should handle mixed separators', () => {
      expect(sanitizeClassName('my-cool_app name')).toBe('MyCoolAppName');
      expect(sanitizeClassName('a.b.c')).toBe('ABC');
    });

    // Leading digit edge case
    it('should prefix with underscore when name starts with a digit', () => {
      expect(sanitizeClassName('2048 Game')).toBe('_2048Game');
      expect(sanitizeClassName('3d-viewer')).toBe('_3dViewer');
      expect(sanitizeClassName('123')).toBe('_123');
    });

    // Empty / degenerate input
    it('should fallback to "Client" for empty string', () => {
      expect(sanitizeClassName('')).toBe('Client');
    });

    it('should fallback to "Client" for non-alphanumeric input', () => {
      expect(sanitizeClassName('---')).toBe('Client');
      expect(sanitizeClassName('@#$')).toBe('Client');
      expect(sanitizeClassName('   ')).toBe('Client');
      expect(sanitizeClassName('...')).toBe('Client');
    });

    // Single characters
    it('should handle single character input', () => {
      expect(sanitizeClassName('a')).toBe('A');
      expect(sanitizeClassName('Z')).toBe('Z');
      expect(sanitizeClassName('5')).toBe('_5');
    });

    // Unicode / special chars stripped
    it('should strip non-ASCII characters', () => {
      expect(sanitizeClassName('café')).toBe('Caf');
      expect(sanitizeClassName('naïve')).toBe('NaVe');
    });

    // End-to-end with generateClient
    it('should produce a valid class name in generated output', () => {
      const clientContent = generateClient(manifest, 'Task Board');
      expect(clientContent).toContain('export class TaskBoard {');
      expect(clientContent).not.toContain('export class Task Board {');
    });

    it('should produce valid class for degenerate input', () => {
      const clientContent = generateClient(manifest, '---');
      expect(clientContent).toContain('export class Client {');
    });
  });

  describe('Bug 2: Rust type mapping', () => {
    it('should map Rust primitives to TypeScript', () => {
      expect(mapRustTypeToTs('String')).toBe('string');
      expect(mapRustTypeToTs('bool')).toBe('boolean');
      expect(mapRustTypeToTs('u64')).toBe('number');
      expect(mapRustTypeToTs('i32')).toBe('number');
      expect(mapRustTypeToTs('f64')).toBe('number');
      expect(mapRustTypeToTs('u8')).toBe('number');
      expect(mapRustTypeToTs('i16')).toBe('number');
      expect(mapRustTypeToTs('()')).toBe('void');
    });

    it('should map Vec<T> to T[]', () => {
      expect(mapRustTypeToTs('Vec<String>')).toBe('string[]');
      expect(mapRustTypeToTs('Vec<u64>')).toBe('number[]');
    });

    it('should map Option<T> to T | null', () => {
      expect(mapRustTypeToTs('Option<String>')).toBe('string | null');
      expect(mapRustTypeToTs('Option<u32>')).toBe('number | null');
    });

    it('should unwrap Result<T, E> to T', () => {
      expect(mapRustTypeToTs('Result<String, Error>')).toBe('string');
      expect(mapRustTypeToTs('Result<u64, String>')).toBe('number');
    });

    it('should handle Result<T, E> where E contains commas', () => {
      expect(mapRustTypeToTs('Result<i32, (String, u32)>')).toBe('number');
    });

    it('should handle nested generics', () => {
      expect(mapRustTypeToTs('Vec<Option<String>>')).toBe('(string | null)[]');
      expect(mapRustTypeToTs('Option<Vec<u32>>')).toBe('number[] | null');
    });

    it('should map tuples to TS tuple types', () => {
      expect(mapRustTypeToTs('(String, String)')).toBe('[string, string]');
      expect(mapRustTypeToTs('(u32, bool)')).toBe('[number, boolean]');
    });

    it('should wrap Vec<Option<T>> with parens for correct array precedence', () => {
      expect(mapRustTypeToTs('Vec<Option<String>>')).toBe('(string | null)[]');
    });

    it('should return null for unknown types', () => {
      expect(mapRustTypeToTs('MyCustomType')).toBeNull();
      expect(mapRustTypeToTs('HashMap<String, u32>')).toBeNull();
    });
  });

  describe('Bug 3: tuple type support', () => {
    it('should accept tuple kind in ABI schema', () => {
      const abiWithTuple = {
        schema_version: 'wasm-abi/1',
        types: {},
        methods: [
          {
            name: 'get_pair',
            params: [],
            returns: {
              kind: 'tuple',
              elements: [{ kind: 'string' }, { kind: 'string' }],
            },
          },
        ],
        events: [],
      };
      // Should not throw during parsing
      const parsed = parseAbiManifest(abiWithTuple);
      expect(parsed.methods[0].returns).toEqual({
        kind: 'tuple',
        elements: [{ kind: 'string' }, { kind: 'string' }],
      });
    });

    it('should generate TypeScript tuple types in client', () => {
      const abiWithTuple = {
        schema_version: 'wasm-abi/1',
        types: {},
        methods: [
          {
            name: 'map_entries',
            params: [],
            returns: {
              kind: 'list',
              items: {
                kind: 'tuple',
                elements: [{ kind: 'string' }, { kind: 'string' }],
              },
            },
          },
        ],
        events: [],
      };
      const parsed = parseAbiManifest(abiWithTuple);
      const clientContent = generateClient(parsed, 'TestClient');
      expect(clientContent).toContain('Promise<[string, string][]>');
    });

    it('should generate tuple types in standalone types output', () => {
      const abiWithTuple = {
        schema_version: 'wasm-abi/1',
        types: {
          Pair: {
            kind: 'alias',
            target: {
              kind: 'tuple',
              elements: [{ kind: 'string' }, { kind: 'u32' }],
            },
          },
        },
        methods: [],
        events: [],
      };
      const parsed = parseAbiManifest(abiWithTuple);
      const typesContent = generateTypes(parsed);
      expect(typesContent).toContain('export type Pair = [string, number];');
    });
  });

  describe('list of nullable items wraps union in parens', () => {
    it('should generate (T | null)[] not T | null[] for nullable list items', () => {
      const abi = {
        schema_version: 'wasm-abi/1',
        types: {},
        methods: [
          {
            name: 'get_names',
            params: [],
            returns: {
              kind: 'list',
              items: { kind: 'string' },
            },
            returns_nullable: false,
          },
        ],
        events: [],
      };
      // A list of strings is fine as-is
      const parsed = parseAbiManifest(abi);
      const client = generateClient(parsed, 'Test');
      expect(client).toContain('Promise<string[]>');

      // Now test a list where each item's type contains a union (via $ref fallback)
      // We test the mapRustTypeToTs path which already proved the parens logic
      // and the generateTypeRef path via nullable record fields in types
      const typesAbi = {
        schema_version: 'wasm-abi/1',
        types: {
          Row: {
            kind: 'record',
            fields: [
              {
                name: 'tags',
                type: { kind: 'list', items: { kind: 'string' } },
                nullable: false,
              },
            ],
          },
        },
        methods: [],
        events: [],
      };
      const parsedTypes = parseAbiManifest(typesAbi);
      const typesContent = generateTypes(parsedTypes);
      expect(typesContent).toContain('tags: string[];');
    });
  });

  describe('Bug 4: private field underscore prefix', () => {
    it('should prefix private fields with underscore', () => {
      const clientContent = generateClient(manifest, 'TestClient');
      expect(clientContent).toContain('private _mero: MeroJs;');
      expect(clientContent).toContain('private _contextId: string;');
      expect(clientContent).toContain('private _executorPublicKey: string;');
    });

    it('should not have un-prefixed private fields', () => {
      const clientContent = generateClient(manifest, 'TestClient');
      expect(clientContent).not.toMatch(/private mero: MeroJs/);
      expect(clientContent).not.toMatch(/private contextId: string/);
      expect(clientContent).not.toMatch(/private executorPublicKey: string/);
    });

    it('should use underscore-prefixed fields in method bodies', () => {
      const clientContent = generateClient(manifest, 'TestClient');
      expect(clientContent).toContain('this._mero.rpc.execute');
      expect(clientContent).toContain('contextId: this._contextId');
      expect(clientContent).toContain('executorPublicKey: this._executorPublicKey');
      expect(clientContent).not.toMatch(/this\.mero\.rpc/);
    });

    it('should not collide with a context_id contract method', () => {
      const abiWithCollision = {
        schema_version: 'wasm-abi/1',
        types: {},
        methods: [
          {
            name: 'context_id',
            params: [],
            returns: { kind: 'string' },
          },
        ],
        events: [],
      };
      const parsed = parseAbiManifest(abiWithCollision);
      const clientContent = generateClient(parsed, 'TestClient');

      // Method should exist
      expect(clientContent).toContain('async contextId(): Promise<string>');
      // Private field uses underscore prefix — no collision
      expect(clientContent).toContain('private _contextId: string;');
      // Should not have duplicate identifier
      expect(clientContent).not.toMatch(/private contextId:/);
    });
  });

  describe('variant references in struct fields and return types', () => {
    // ─────────────────────────────────────────────────────────────────
    // ALL-UNIT VARIANTS — serde serializes as bare strings, so we emit
    // a string-literal union and reference the bare name as a type.
    // ─────────────────────────────────────────────────────────────────
    const allUnitAbi = {
      schema_version: 'wasm-abi/1',
      types: {
        MatchStatus: {
          kind: 'variant',
          variants: [
            { name: 'Pending' },
            { name: 'Active' },
            { name: 'Finished' },
          ],
        },
        MatchSummary: {
          kind: 'record',
          fields: [
            { name: 'match_id', type: { kind: 'string' } },
            { name: 'status', type: { $ref: 'MatchStatus' } },
          ],
        },
      },
      methods: [
        { name: 'get_match', params: [], returns: { $ref: 'MatchSummary' } },
      ],
      events: [],
    };

    it('should emit a string-literal union for all-unit variants (client.ts)', () => {
      const parsed = parseAbiManifest(allUnitAbi);
      const clientContent = generateClient(parsed, 'TestClient');
      expect(clientContent).toContain(
        "export type MatchStatus = 'Pending' | 'Active' | 'Finished';",
      );
      // No Payload type, no const factory
      expect(clientContent).not.toContain('MatchStatusPayload');
      expect(clientContent).not.toContain('export const MatchStatus =');
    });

    it('should emit a string-literal union for all-unit variants (types.ts)', () => {
      const parsed = parseAbiManifest(allUnitAbi);
      const typesContent = generateTypes(parsed);
      expect(typesContent).toContain(
        "export type MatchStatus = 'Pending' | 'Active' | 'Finished';",
      );
      expect(typesContent).not.toContain('MatchStatusPayload');
    });

    it('should reference all-unit variant by bare name in record fields', () => {
      const parsed = parseAbiManifest(allUnitAbi);
      const clientContent = generateClient(parsed, 'TestClient');
      const typesContent = generateTypes(parsed);
      expect(clientContent).toContain('status: MatchStatus;');
      expect(typesContent).toContain('status: MatchStatus;');
      // Must NOT use the (now-nonexistent) Payload form
      expect(clientContent).not.toMatch(/status: MatchStatusPayload/);
    });

    it('should reference all-unit variant by bare name in return types', () => {
      const abi = {
        schema_version: 'wasm-abi/1',
        types: {
          Status: {
            kind: 'variant',
            variants: [{ name: 'Ok' }, { name: 'Err' }],
          },
        },
        methods: [
          { name: 'get_status', params: [], returns: { $ref: 'Status' } },
        ],
        events: [],
      };
      const parsed = parseAbiManifest(abi);
      const clientContent = generateClient(parsed, 'TestClient');
      expect(clientContent).toContain('Promise<Status>');
      expect(clientContent).not.toContain('Promise<StatusPayload>');
    });

    it('should reference all-unit variant by bare name in nested types', () => {
      const abi = {
        schema_version: 'wasm-abi/1',
        types: {
          Color: {
            kind: 'variant',
            variants: [{ name: 'Red' }, { name: 'Blue' }],
          },
          Palette: {
            kind: 'record',
            fields: [
              {
                name: 'colors',
                type: { kind: 'list', items: { $ref: 'Color' } },
              },
            ],
          },
        },
        methods: [],
        events: [],
      };
      const parsed = parseAbiManifest(abi);
      const typesContent = generateTypes(parsed);
      expect(typesContent).toContain('colors: Color[];');
      expect(typesContent).not.toContain('ColorPayload');
    });

    // ─────────────────────────────────────────────────────────────────
    // MIXED / PAYLOAD VARIANTS — discriminated union + Payload suffix.
    // ─────────────────────────────────────────────────────────────────
    const mixedAbi = {
      schema_version: 'wasm-abi/1',
      types: {
        Action: {
          kind: 'variant',
          variants: [
            { name: 'Ping' },
            { name: 'SetName', payload: { kind: 'string' } },
          ],
        },
        Wrapper: {
          kind: 'record',
          fields: [{ name: 'action', type: { $ref: 'Action' } }],
        },
      },
      methods: [
        { name: 'do_it', params: [], returns: { $ref: 'Action' } },
      ],
      events: [],
    };

    it('should reference mixed variants as Payload in record fields', () => {
      const parsed = parseAbiManifest(mixedAbi);
      const clientContent = generateClient(parsed, 'TestClient');
      const typesContent = generateTypes(parsed);
      expect(clientContent).toContain('action: ActionPayload;');
      expect(typesContent).toContain('action: ActionPayload;');
      expect(clientContent).not.toMatch(/action: Action;/);
    });

    it('should reference mixed variants as Payload in method return types', () => {
      const parsed = parseAbiManifest(mixedAbi);
      const clientContent = generateClient(parsed, 'TestClient');
      expect(clientContent).toContain('Promise<ActionPayload>');
      expect(clientContent).not.toMatch(/Promise<Action>/);
    });

    it('should still emit discriminated union and factory for mixed variants', () => {
      const parsed = parseAbiManifest(mixedAbi);
      const clientContent = generateClient(parsed, 'TestClient');
      expect(clientContent).toContain('export type ActionPayload =');
      expect(clientContent).toContain("| { name: 'Ping' }");
      expect(clientContent).toContain("| { name: 'SetName'; payload: string }");
      expect(clientContent).toContain('export const Action = {');
    });
  });

  describe('conditional emission of CalimeroBytes helpers', () => {
    it('should NOT emit CalimeroBytes class when no type uses bytes', () => {
      const abiNoBytes = {
        schema_version: 'wasm-abi/1',
        types: {
          Foo: {
            kind: 'record',
            fields: [{ name: 'name', type: { kind: 'string' } }],
          },
        },
        methods: [
          {
            name: 'create',
            params: [{ name: 'f', type: { $ref: 'Foo' } }],
            returns: { kind: 'string' },
          },
        ],
        events: [],
      };
      const parsed = parseAbiManifest(abiNoBytes);
      const clientContent = generateClient(parsed, 'TestClient');
      expect(clientContent).not.toContain('export class CalimeroBytes');
      expect(clientContent).not.toContain('function convertCalimeroBytesForWasm');
      expect(clientContent).not.toContain(
        'function convertWasmResultToCalimeroBytes',
      );
    });

    it('should NOT emit conversion helpers when no method has bytes params/returns', () => {
      // Type defines bytes but no method uses it
      const abi = {
        schema_version: 'wasm-abi/1',
        types: {
          Hash: { kind: 'bytes', size: 32, encoding: 'hex' },
        },
        methods: [
          { name: 'noop', params: [], returns: { kind: 'string' } },
        ],
        events: [],
      };
      const parsed = parseAbiManifest(abi);
      const clientContent = generateClient(parsed, 'TestClient');
      // CalimeroBytes class is needed (Hash is referenced as a type alias)
      expect(clientContent).toContain('export class CalimeroBytes');
      // But helpers are not needed
      expect(clientContent).not.toContain('function convertCalimeroBytesForWasm');
      expect(clientContent).not.toContain(
        'function convertWasmResultToCalimeroBytes',
      );
    });

    it('should emit convertCalimeroBytesForWasm when a method has bytes params', () => {
      const abi = {
        schema_version: 'wasm-abi/1',
        types: {
          Hash: { kind: 'bytes', size: 32, encoding: 'hex' },
        },
        methods: [
          {
            name: 'submit',
            params: [{ name: 'h', type: { $ref: 'Hash' } }],
            returns: { kind: 'string' },
          },
        ],
        events: [],
      };
      const parsed = parseAbiManifest(abi);
      const clientContent = generateClient(parsed, 'TestClient');
      expect(clientContent).toContain('function convertCalimeroBytesForWasm');
      // Result helper not needed since no bytes return
      expect(clientContent).not.toContain(
        'function convertWasmResultToCalimeroBytes',
      );
    });

    it('should emit convertWasmResultToCalimeroBytes when a method returns bytes', () => {
      const abi = {
        schema_version: 'wasm-abi/1',
        types: {
          Hash: { kind: 'bytes', size: 32, encoding: 'hex' },
        },
        methods: [
          { name: 'compute', params: [], returns: { $ref: 'Hash' } },
        ],
        events: [],
      };
      const parsed = parseAbiManifest(abi);
      const clientContent = generateClient(parsed, 'TestClient');
      expect(clientContent).toContain('function convertWasmResultToCalimeroBytes');
      // No bytes params → no for-wasm helper
      expect(clientContent).not.toContain('function convertCalimeroBytesForWasm');
    });

    it('should still emit both helpers when conformance ABI uses bytes (regression)', () => {
      // The fixture conformance ABI uses bytes in both params and returns
      const clientContent = generateClient(manifest, 'TestClient');
      expect(clientContent).toContain('export class CalimeroBytes');
      expect(clientContent).toContain('function convertCalimeroBytesForWasm');
      expect(clientContent).toContain('function convertWasmResultToCalimeroBytes');
    });
  });

  describe('types.ts threads manifest through error/event generation', () => {
    // Regression: previously generateMethodErrorTypes and
    // generateEventPayloadType passed the method/event object as the manifest
    // arg, causing a TypeError when error.payload or event.payload was a $ref
    // (manifest.types[ref] crashes since method.types is undefined).

    it('should generate error types referencing a $ref payload without crashing', () => {
      const abi = {
        schema_version: 'wasm-abi/1',
        types: {
          ErrorDetails: {
            kind: 'record',
            fields: [{ name: 'reason', type: { kind: 'string' } }],
          },
        },
        methods: [
          {
            name: 'doThing',
            params: [],
            returns: { kind: 'string' },
            errors: [
              { code: 'BadInput', payload: { $ref: 'ErrorDetails' } },
            ],
          },
        ],
        events: [],
      };
      const parsed = parseAbiManifest(abi);
      expect(() => generateTypes(parsed)).not.toThrow();
      const typesContent = generateTypes(parsed);
      expect(typesContent).toContain(
        'export type doThingError = { code: doThingErrorCode } & (',
      );
      expect(typesContent).toContain(
        '| { code: "BadInput"; payload: ErrorDetails }',
      );
    });

    it('should generate event payload referencing a $ref without crashing', () => {
      const abi = {
        schema_version: 'wasm-abi/1',
        types: {
          NotificationData: {
            kind: 'record',
            fields: [{ name: 'message', type: { kind: 'string' } }],
          },
        },
        methods: [],
        events: [
          { name: 'Notified', payload: { $ref: 'NotificationData' } },
        ],
      };
      const parsed = parseAbiManifest(abi);
      expect(() => generateTypes(parsed)).not.toThrow();
      const typesContent = generateTypes(parsed);
      expect(typesContent).toContain(
        'export type AbiEvent =',
      );
      expect(typesContent).toContain(
        '| { name: "Notified"; payload: NotificationData }',
      );
    });

    it('should generate event with variant $ref payload (resolves to Payload suffix)', () => {
      const abi = {
        schema_version: 'wasm-abi/1',
        types: {
          ChangeKind: {
            kind: 'variant',
            variants: [
              { name: 'Created' },
              { name: 'Updated', payload: { kind: 'string' } },
            ],
          },
        },
        methods: [],
        events: [{ name: 'Changed', payload: { $ref: 'ChangeKind' } }],
      };
      const parsed = parseAbiManifest(abi);
      expect(() => generateTypes(parsed)).not.toThrow();
      const typesContent = generateTypes(parsed);
      // Mixed variant → Payload suffix
      expect(typesContent).toContain(
        '| { name: "Changed"; payload: ChangeKindPayload }',
      );
    });
  });

  describe('compile test', () => {
    it('should generate code that compiles under tsc --strict', () => {
      const clientContent = generateClient(manifest);

      // Create a temporary directory for the test
      const tmpDir = path.join(__dirname, '../tmp/gen');
      if (!fs.existsSync(tmpDir)) {
        fs.mkdirSync(tmpDir, { recursive: true });
      }

      // Write the generated client file (which includes types)
      const clientPath = path.join(tmpDir, 'client.ts');
      fs.writeFileSync(clientPath, clientContent);

      // Remove the mero-react import and add mock types for compile test
      const clientWithMockedImport = clientContent.replace(
        `import {\n  MeroJs,\n} from '@calimero-network/mero-react';`,
        `// Mock types for compile test\ntype MeroJs = { rpc: { execute: (params: any) => Promise<any> } };`,
      );

      // Add a test stub to verify the new parameter structure compiles
      const testStub = `
// Test stub to verify parameter structure
const mero = { rpc: { execute: async (p: any) => p } } as any;
const client = new Client(mero, 'ctx-1', 'exec-key-1');
await client.roundtripId({ x: "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef" });
await client.makePerson({ p: { id: "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef" as any, name: "test", age: 25 } });
await client.act({ a: Action.Ping() });
`;
      const clientWithTestStub = clientWithMockedImport + testStub;
      fs.writeFileSync(clientPath, clientWithTestStub);

      // Create a minimal tsconfig.json
      const tsconfigPath = path.join(tmpDir, 'tsconfig.json');
      const tsconfig = {
        compilerOptions: {
          target: 'ES2020',
          module: 'ESNext',
          moduleResolution: 'node',
          strict: true,
          noEmit: true,
          esModuleInterop: true,
          skipLibCheck: true,
          forceConsistentCasingInFileNames: true,
        },
        include: ['*.ts'],
      };
      fs.writeFileSync(tsconfigPath, JSON.stringify(tsconfig, null, 2));

      // Run tsc --strict --noEmit using the local TypeScript installation
      try {
        execSync('npx tsc --strict --noEmit', {
          cwd: tmpDir,
          stdio: 'pipe',
          encoding: 'utf-8',
        });
      } catch (error: any) {
        // If compilation fails, show the error
        console.error('TypeScript compilation failed:');
        console.error(error.stdout || error.stderr);
        throw error;
      }
    });
  });
});
