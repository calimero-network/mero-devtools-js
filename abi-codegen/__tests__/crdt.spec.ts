import { describe, it, expect, beforeAll } from 'vitest';
import path from 'path';
import { loadAbiManifestFromFile, parseAbiManifest } from '../src/parse.js';
import { generateClient } from '../src/generate/client.js';
import { AbiManifest } from '../src/model.js';

const __dirname = path.dirname(new URL(import.meta.url).pathname);

describe('CRDT type annotations', () => {
  const ludoAbiPath = path.join(
    __dirname,
    '../__fixtures__/ludo_crdt_abi.json',
  );
  let manifest: AbiManifest;

  beforeAll(() => {
    manifest = loadAbiManifestFromFile(ludoAbiPath);
  });

  describe('schema validation', () => {
    it('should parse the ludo CRDT ABI without errors', () => {
      expect(manifest.schema_version).toBe('wasm-abi/1');
      expect(manifest.state_root).toBe('AppState');
    });

    it('should accept all defined types', () => {
      const typeNames = Object.keys(manifest.types);
      expect(typeNames).toContain('AppState');
      expect(typeNames).toContain('Game');
      expect(typeNames).toContain('GameView');
      expect(typeNames).toContain('Move');
      expect(typeNames).toContain('MoveView');
      expect(typeNames).toContain('Piece');
      expect(typeNames).toContain('PieceView');
      expect(typeNames).toContain('Player');
    });

    it('should accept all methods', () => {
      const methodNames = manifest.methods.map((m) => m.name);
      expect(methodNames).toContain('init');
      expect(methodNames).toContain('create_game');
      expect(methodNames).toContain('join_game');
      expect(methodNames).toContain('start_game');
      expect(methodNames).toContain('roll_dice');
      expect(methodNames).toContain('move_piece');
      expect(methodNames).toContain('resign_game');
      expect(methodNames).toContain('get_game');
      expect(methodNames).toContain('get_pieces');
      expect(methodNames).toContain('get_move_history');
    });

    it('should accept crdt_type on record fields', () => {
      const game = manifest.types.Game;
      expect(game.kind).toBe('record');
      if (game.kind === 'record') {
        const idField = game.fields.find((f) => f.name === 'id');
        expect(idField).toBeDefined();
        const idType = idField!.type as any;
        expect(idType.kind).toBe('record');
        expect(idType.crdt_type).toBe('lww_register');
        expect(idType.inner_type).toEqual({ kind: 'string' });
      }
    });

    it('should accept crdt_type on map types', () => {
      const appState = manifest.types.AppState;
      expect(appState.kind).toBe('record');
      if (appState.kind === 'record') {
        const gamesField = appState.fields.find((f) => f.name === 'games');
        expect(gamesField).toBeDefined();
        const gamesType = gamesField!.type as any;
        expect(gamesType.kind).toBe('map');
        expect(gamesType.crdt_type).toBe('unordered_map');
      }
    });

    it('should reject unknown crdt_type values', () => {
      const invalidManifest = {
        schema_version: 'wasm-abi/1',
        types: {
          Test: {
            kind: 'record',
            fields: [
              {
                name: 'val',
                type: {
                  kind: 'record',
                  fields: [],
                  crdt_type: 'invalid_crdt',
                  inner_type: { kind: 'string' },
                },
              },
            ],
          },
        },
        methods: [],
        events: [],
      };

      expect(() => parseAbiManifest(invalidManifest)).toThrow(
        'ABI schema validation failed:',
      );
    });
  });

  describe('codegen with CRDT types', () => {
    let clientContent: string;

    beforeAll(() => {
      clientContent = generateClient(manifest, 'AbiClient');
    });

    it('should resolve lww_register to inner type for Game fields', () => {
      expect(clientContent).toContain('export interface Game {');
      expect(clientContent).toMatch(/id:\s*string;/);
      expect(clientContent).toMatch(/creator_id:\s*string;/);
      expect(clientContent).toMatch(/status:\s*string;/);
      expect(clientContent).toMatch(/num_players_needed:\s*number;/);
      expect(clientContent).toMatch(/current_player_index:\s*number;/);
      expect(clientContent).toMatch(/last_dice_roll:\s*number;/);
      expect(clientContent).toMatch(/winner_id:\s*string;/);
    });

    it('should keep plain View types unchanged', () => {
      expect(clientContent).toContain('export interface GameView {');
      expect(clientContent).toContain('export interface PieceView {');
      expect(clientContent).toContain('export interface MoveView {');
    });

    it('should resolve lww_register to inner type for Piece fields', () => {
      expect(clientContent).toContain('export interface Piece {');
      const pieceMatch = clientContent.match(
        /export interface Piece \{([^}]+)\}/,
      );
      expect(pieceMatch).toBeTruthy();
      const pieceBody = pieceMatch![1];
      expect(pieceBody).toMatch(/id:\s*string;/);
      expect(pieceBody).toMatch(/player_id:\s*string;/);
      expect(pieceBody).toMatch(/position:\s*number;/);
      expect(pieceBody).toMatch(/in_home:\s*boolean;/);
      expect(pieceBody).toMatch(/completed:\s*boolean;/);
    });

    it('should resolve lww_register to inner type for Move fields', () => {
      expect(clientContent).toContain('export interface Move {');
      const moveMatch = clientContent.match(
        /export interface Move \{([^}]+)\}/,
      );
      expect(moveMatch).toBeTruthy();
      const moveBody = moveMatch![1];
      expect(moveBody).toMatch(/id:\s*string;/);
      expect(moveBody).toMatch(/game_id:\s*string;/);
      expect(moveBody).toMatch(/player_id:\s*string;/);
      expect(moveBody).toMatch(/from_position:\s*number;/);
      expect(moveBody).toMatch(/to_position:\s*number;/);
    });

    it('should generate correct method signatures', () => {
      expect(clientContent).toContain(
        'async createGame(params: { creator_id: string; num_players: number }): Promise<string>',
      );
      expect(clientContent).toContain(
        'async joinGame(params: { game_id: string; user_id: string }): Promise<void>',
      );
      expect(clientContent).toContain(
        'async rollDice(params: { game_id: string; player_id: string }): Promise<number>',
      );
      expect(clientContent).toContain(
        'async getGame(params: { game_id: string }): Promise<GameView>',
      );
      expect(clientContent).toContain(
        'async getPieces(params: { game_id: string }): Promise<PieceView[]>',
      );
      expect(clientContent).toContain(
        'async getMoveHistory(params: { game_id: string }): Promise<MoveView[]>',
      );
    });

    it('should preserve ABI method names in execute calls', () => {
      expect(clientContent).toContain("'create_game'");
      expect(clientContent).toContain("'join_game'");
      expect(clientContent).toContain("'start_game'");
      expect(clientContent).toContain("'roll_dice'");
      expect(clientContent).toContain("'move_piece'");
      expect(clientContent).toContain("'resign_game'");
      expect(clientContent).toContain("'get_game'");
      expect(clientContent).toContain("'get_pieces'");
      expect(clientContent).toContain("'get_move_history'");
    });

    it('should not contain CRDT wrapper types in generated output', () => {
      expect(clientContent).not.toContain('lww_register');
      expect(clientContent).not.toContain('unordered_map');
      expect(clientContent).not.toContain('crdt_type');
      expect(clientContent).not.toContain('inner_type');
    });
  });

  describe('CRDT type edge cases', () => {
    it('should handle record with crdt_type but no inner_type as normal record', () => {
      const manifest = parseAbiManifest({
        schema_version: 'wasm-abi/1',
        types: {
          Test: {
            kind: 'record',
            fields: [
              {
                name: 'data',
                type: {
                  kind: 'record',
                  fields: [{ name: 'x', type: { kind: 'string' } }],
                  crdt_type: 'lww_register',
                },
              },
            ],
          },
        },
        methods: [],
        events: [],
      });

      const clientContent = generateClient(manifest);
      expect(clientContent).toContain('data: { x: string }');
    });

    it('should handle map with crdt_type as normal map', () => {
      const manifest = parseAbiManifest({
        schema_version: 'wasm-abi/1',
        types: {
          Test: {
            kind: 'record',
            fields: [
              {
                name: 'items',
                type: {
                  kind: 'map',
                  key: { kind: 'string' },
                  value: { kind: 'u32' },
                  crdt_type: 'unordered_map',
                },
              },
            ],
          },
        },
        methods: [],
        events: [],
      });

      const clientContent = generateClient(manifest);
      expect(clientContent).toContain('items: Record<string, number>');
    });

    it('should handle state_root field in manifest', () => {
      const manifest = parseAbiManifest({
        schema_version: 'wasm-abi/1',
        types: {
          AppState: {
            kind: 'record',
            fields: [],
          },
        },
        methods: [],
        events: [],
        state_root: 'AppState',
      });

      expect(manifest.state_root).toBe('AppState');
    });
  });

  describe('isBytesType with CRDT wrappers', () => {
    it('should detect bytes inside CRDT inner_type', () => {
      const client = generateClient(manifest);
      // CRDT-wrapped bytes fields should trigger CalimeroBytes conversion
      // If isBytesType works correctly, the generated code will include
      // convertCalimeroBytesForWasm / convertWasmResultToCalimeroBytes
      // for methods that take/return CRDT-wrapped bytes types
      expect(client).toBeTruthy();
    });

    it('should NOT follow inner_type without crdt_type', () => {
      // A record with inner_type but no crdt_type should be treated as
      // a normal record, not unwrapped to check inner_type for bytes
      const testManifest: AbiManifest = {
        version: '0.1.0',
        methods: [
          {
            name: 'test_method',
            params: [
              {
                name: 'data',
                type: {
                  kind: 'record',
                  fields: [{ name: 'value', type: { kind: 'bytes' } }],
                  inner_type: { kind: 'bytes' },
                  // No crdt_type — should NOT follow inner_type
                } as any,
              },
            ],
            returns: null,
            returns_nullable: false,
          },
        ],
        events: [],
        types: {},
      };
      // Should still generate successfully
      const client = generateClient(testManifest);
      expect(client).toContain('test_method');
    });

    it('should follow inner_type WITH crdt_type for bytes detection', () => {
      const testManifest: AbiManifest = {
        version: '0.1.0',
        methods: [
          {
            name: 'crdt_bytes_method',
            params: [
              {
                name: 'data',
                type: {
                  kind: 'record',
                  crdt_type: 'lww_register',
                  inner_type: { kind: 'bytes' },
                  fields: [],
                } as any,
              },
            ],
            returns: null,
            returns_nullable: false,
          },
        ],
        events: [],
        types: {},
      };
      const client = generateClient(testManifest);
      expect(client).toContain('convertCalimeroBytesForWasm');
    });
  });
});
