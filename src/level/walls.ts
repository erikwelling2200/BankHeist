import { TILE } from './level';
import { px, type Insets } from './space';

/**
 * Walls stand on the edges between tiles, not on tiles, at their real thickness: a plaster partition is a few pixels
 * thick, not a metre-wide block, and every tile stays usable floor. A wall segment is one tile long.
 *
 * `eastWest` segments run along the north edge of tile (tx, ty); `northSouth` segments along its west edge. A segment
 * is centred on its edge line, so it takes a pixel or two from the tiles on either side.
 */
export type WallRun = 'eastWest' | 'northSouth';

/**
 * What a segment is made of. Plaster, concrete and the vault's steel are solid walls (Soft, Reinforced and Vault in the
 * design), brick the outside walls; doors, and the fronts' piers, windows, glass doors, ATM, boarded windows and
 * shutters, are segments of their own. An office tower fronts the street with a glass curtain wall. A railing runs along
 * the open edge of raised tiles and stairs: half cover, see-through, never cut down.
 */
export type WallKind = 'plaster' | 'concrete' | 'vault' | 'vaultDoor' | 'brick' | 'doorWood' | 'doorKeycard' | 'doorService'
    | 'pier' | 'brickPier' | 'window' | 'doorGlass' | 'atm' | 'boarded' | 'shutter' | 'curtain' | 'doorTower' | 'rail';

export interface Wall { kind: WallKind; run: WallRun; tx: number; ty: number }

/** Thickness by kind: a plaster partition, a reinforced concrete wall, the shop front's stone and glass. */
export const WALL_THICKNESS: Record<WallKind, number> = {
    plaster: px(0.2),
    concrete: px(0.4),
    vault: px(0.6),
    vaultDoor: px(0.6),
    brick: px(0.3),
    doorWood: px(0.2),
    doorKeycard: px(0.2),
    doorService: px(0.3),
    pier: px(0.3),
    brickPier: px(0.3),
    window: px(0.3),
    doorGlass: px(0.3),
    atm: px(0.3),
    boarded: px(0.3),
    shutter: px(0.3),
    curtain: px(0.2),
    doorTower: px(0.2),
    rail: px(0.1)
};

/** A wall segment's footprint on the floor, in pixels. */
export interface Footprint { x: number; y: number; w: number; d: number }

export function wallFootprint(wall: Wall): Footprint {
    const t = WALL_THICKNESS[wall.kind], back = Math.floor(t / 2);
    return wall.run === 'eastWest'
        ? { x: wall.tx * TILE, y: wall.ty * TILE - back, w: TILE, d: t }
        : { x: wall.tx * TILE - back, y: wall.ty * TILE, w: t, d: TILE };
}

/** How far walls reach into a rectangle of tiles from each side, so whatever stands against them stands against their face. */
export function wallInsets(walls: readonly Wall[], tx: number, ty: number, w: number, d: number): Insets {
    const reach = (edge: (wall: Wall) => boolean, side: 'near' | 'far') => Math.max(0, ...walls.filter(edge).map(wall => {
        const t = WALL_THICKNESS[wall.kind], back = Math.floor(t / 2);
        return side === 'far' ? t - back : back;
    }));
    const across = (wall: Wall) => wall.tx >= tx && wall.tx < tx + w, down = (wall: Wall) => wall.ty >= ty && wall.ty < ty + d;
    return {
        north: reach(wall => wall.run === 'eastWest' && wall.ty === ty && across(wall), 'far'),
        south: reach(wall => wall.run === 'eastWest' && wall.ty === ty + d && across(wall), 'near'),
        west: reach(wall => wall.run === 'northSouth' && wall.tx === tx && down(wall), 'far'),
        east: reach(wall => wall.run === 'northSouth' && wall.tx === tx + w && down(wall), 'near')
    };
}
