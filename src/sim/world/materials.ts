import type { WallKind } from '../../level/walls';
import type { EdgeProps } from '../core/types';

/*
 * What each kind of wall segment the generator builds is in the rules (§14.1, §14.2; implementation plan §6.8): its
 * material, whether it blocks sight and movement, and whether it gives half cover. Glass (and the teller glass, the
 * chain-link fence and the railings) lets sight through; nothing here lets a person through, except a door once open.
 * A door's row describes it closed.
 *
 * The generator's own sight rule (`SEE_THROUGH` in src/gen/nav.ts) agrees with `blocksSight` here; a test holds them to it.
 */

export interface WallMaterial extends EdgeProps {
    /** A low segment to crouch behind (a railing): half cover (§11.4). */
    halfCover: boolean;
}

const solid = (material: EdgeProps['material']): WallMaterial => ({ material, blocksSight: true, blocksMove: true, halfCover: false });
const clear = (material: EdgeProps['material']): WallMaterial => ({ material, blocksSight: false, blocksMove: true, halfCover: false });

export const WALL_MATERIALS: Readonly<Record<WallKind, Readonly<WallMaterial>>> = {
    // Soft: drywall, wood, boards and the rolling shutter's slats.
    plaster: solid('soft'),
    doorWood: solid('soft'),
    boarded: solid('soft'),
    shutter: solid('soft'),
    // Reinforced: concrete and brick, the fronts' piers, the cash machine, and steel doors (keycard doors are steel).
    concrete: solid('reinforced'),
    brick: solid('reinforced'),
    pier: solid('reinforced'),
    brickPier: solid('reinforced'),
    atm: solid('reinforced'),
    doorService: solid('reinforced'),
    doorBack: solid('reinforced'),
    doorKeycard: solid('reinforced'),
    // Vault: the vault's steel and its door, and an old bank's metre-thick stone.
    vault: solid('vault'),
    vaultDoor: solid('vault'),
    thick: solid('vault'),
    // Glass: windows, glass doors, an office tower's curtain wall and its doors; the teller window's armoured glass.
    window: clear('glass'),
    doorGlass: clear('glass'),
    curtain: clear('glass'),
    doorTower: clear('glass'),
    tellerWindow: clear('tellerGlass'),
    // A chain-link fence and a railing pass sight, sound and bullets but nobody; a railing is low: half cover.
    fence: clear('fence'),
    rail: { ...clear('rail'), halfCover: true }
};

/**
 * The wall kinds that are doors: each stands where the generator put a door, or beside one as its other leaf, and
 * opens. A rolling shutter is a door too (the loading bay's).
 */
export const DOOR_KINDS: readonly WallKind[] = ['doorWood', 'doorKeycard', 'doorService', 'doorGlass', 'doorTower', 'doorBack', 'vaultDoor', 'shutter'];
