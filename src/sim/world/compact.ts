import type { ReadonlyWorld, Tile, World } from '../core/types';

/*
 * The saved world's tiles, packed (§20.6): a generated bank has thousands of tiles, and as JSON objects they are most of
 * the save. Packed, each field of `Tile` is one column over all tiles, row-major:
 *
 * - booleans as a string of '0' and '1';
 * - strings, numbers and null (a zone, a floor height, a room) as a table of the values and each tile's index into it,
 *   one character per tile while the table has at most 64 values;
 * - anything else, and any field some tiles lack (`climb`), as a record of the tiles that have it, by index.
 *
 * Columns are run-length encoded where that is shorter ("0*120,1*3,0"). Fields are found from the tiles themselves, so
 * a package that augments `Tile` is packed without changes here.
 */

type Scalar = string | number | null;
type Column =
    | { bits: string }
    | { table: Scalar[]; index: string }
    | { table: Scalar[]; indices: number[] }
    | { sparse: Record<string, unknown> };

export interface PackedTiles { count: number; columns: Record<string, Column> }
export type PackedWorld = Omit<World, 'tiles'> & { tiles: PackedTiles };

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ-_';

/** A string of one character per tile, run-length encoded as `c*n` runs joined by ',' when that is shorter. */
function rle(s: string): string {
    const runs: string[] = [];
    for (let i = 0; i < s.length;) {
        let j = i + 1;
        while (j < s.length && s[j] === s[i]) j++;
        runs.push(j - i > 1 ? `${s[i]}*${j - i}` : s[i]!);
        i = j;
    }
    const packed = runs.join(',');
    return packed.length < s.length ? `~${packed}` : s;
}

function unrle(s: string, count: number): string {
    const out = !s.startsWith('~') ? s : s.slice(1).split(',').map(run => {
        const star = run.indexOf('*');
        return star < 0 ? run : run.slice(0, star).repeat(Number(run.slice(star + 1)));
    }).join('');
    if (out.length !== count) throw new Error(`A packed column has ${out.length} tiles, expected ${count}`);
    return out;
}

const isScalar = (v: unknown): v is Scalar => v === null || typeof v === 'string' || typeof v === 'number';

export function packTiles(tiles: ReadonlyWorld['tiles']): PackedTiles {
    const keys = [...new Set(tiles.flatMap(t => Object.keys(t)))];
    const columns: Record<string, Column> = {};
    for (const key of keys) {
        const values = tiles.map(t => (t as Record<string, unknown>)[key]);
        const everywhere = tiles.every(t => Object.hasOwn(t, key));
        if (everywhere && values.every(v => typeof v === 'boolean')) {
            columns[key] = { bits: rle(values.map(v => (v ? '1' : '0')).join('')) };
        } else if (everywhere && values.every(isScalar)) {
            const table = [...new Set(values as Scalar[])], at = new Map(table.map((v, i) => [v, i]));
            const indices = (values as Scalar[]).map(v => at.get(v)!);
            columns[key] = table.length <= ALPHABET.length ? { table, index: rle(indices.map(i => ALPHABET[i]).join('')) } : { table, indices };
        } else {
            const sparse: Record<string, unknown> = {};
            values.forEach((v, i) => { if (v !== undefined) sparse[i] = v; });
            columns[key] = { sparse };
        }
    }
    return { count: tiles.length, columns };
}

export function unpackTiles(packed: PackedTiles): Tile[] {
    const { count, columns } = packed;
    if (!Number.isInteger(count) || count < 0 || !columns || typeof columns !== 'object') throw new Error('The packed tiles have no count or columns');
    const tiles = Array.from({ length: count }, () => ({}) as Record<string, unknown>);
    for (const [key, column] of Object.entries(columns)) {
        if (key === '__proto__' || key === 'constructor' || key === 'prototype') throw new Error(`A tile can't have the field '${key}'`);
        if ('bits' in column) {
            const bits = unrle(column.bits, count);
            tiles.forEach((t, i) => { t[key] = bits[i] === '1'; });
        } else if ('index' in column || 'indices' in column) {
            const indices = 'index' in column ? [...unrle(column.index, count)].map(c => ALPHABET.indexOf(c)) : column.indices;
            if (indices.length !== count) throw new Error(`The column '${key}' has ${indices.length} tiles, expected ${count}`);
            tiles.forEach((t, i) => {
                const k = indices[i]!;
                if (k < 0 || k >= column.table.length) throw new Error(`The column '${key}' has no value ${k}`);
                t[key] = column.table[k];
            });
        } else if ('sparse' in column) {
            for (const [i, v] of Object.entries(column.sparse)) {
                const tile = tiles[Number(i)];
                if (!tile) throw new Error(`The column '${key}' names tile ${i} of ${count}`);
                tile[key] = v;
            }
        } else throw new Error(`The column '${key}' isn't packed in any known way`);
    }
    return tiles as unknown as Tile[];
}

export function packWorld(world: ReadonlyWorld): PackedWorld {
    return { ...(world as World), tiles: packTiles(world.tiles) };
}

/** A saved world back to a `World` (not yet frozen); one saved with plain tiles is taken as it is. */
export function unpackWorld(saved: PackedWorld | World): World {
    return Array.isArray(saved.tiles) ? (saved as World) : { ...saved, tiles: unpackTiles(saved.tiles) };
}
