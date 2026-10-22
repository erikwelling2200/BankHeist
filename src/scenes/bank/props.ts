import Phaser from 'phaser';
import { roomLamps, windowPatches, type Lamp } from '../../art/bank/lamps';
import { farFront, streetFront, type Caster, type Occluder } from '../../art/bank/lightmap';
import { propArt, type PropArt } from '../../art/bank/props';
import type { PixelBitmap } from '../../art/PixelBitmap';
import type { BankData } from '../../level/bankData';
import { isOnTop, propBox, propSize } from '../../level/catalog';
import { TILE } from '../../level/constants';
import type { LevelProp } from '../../level/plan';
import { baseLine, drawLine, frontRow, GLOW_DEPTH, supportOf, type Box } from '../../level/space';
import { EVERYWHERE, footprintPoints, type Baker } from './bake';
import type { Heights } from './heights';
import { DEPTH } from './layers';
import type { Walls } from './walls';

/** Dressing that matters for play stays in view on a cut wall, as a marker of where it is. */
const ALWAYS_SHOWN: LevelProp['kind'][] = ['camera', 'keycardLed', 'alarmPanel', 'motionSensor'];

/** A prop placed in the level, with its art for the way it faces and, for one standing on another prop, that prop's box. */
export interface PlacedProp { p: LevelProp; box: Box; art: PropArt; left: number; top: number; under?: Box }

/**
 * Every prop by its box (catalog size, level placement), drawn for the way it faces: its bitmap's bottom edge on the
 * box's front edge at the box's elevation, one on another prop's top on the top as drawn.
 */
export function placeProps(bank: BankData): PlacedProp[] {
    const boxes = bank.props.map(p => propBox(p, bank.level.walls));
    return bank.props.map((p, i): PlacedProp => {
        const box = boxes[i]!, art = propArt(p, propSize(p), box.facing), under = isOnTop(p.kind) ? supportOf(box, boxes) : undefined;
        return { p, box, art, under, left: box.x - art.originX, top: frontRow(box, under) - art.lit.height };
    });
}

/** Every light in the bank: the rooms' ceiling lamps, daylight inside the street glass, and the props' own lights. */
export function bankLamps(bank: BankData, props: PlacedProp[]): Lamp[] {
    const far = farFront(bank.level);
    return [
        ...roomLamps(bank.rooms), ...windowPatches(bank.level, streetFront(bank.level).line), ...(far ? windowPatches(bank.level, far.line, 'south') : []),
        ...props.flatMap(propLamps), ...props.filter(({ p }) => p.kind === 'skylight').map(({ box }) => skylightLamp(box))
    ];
}

/** A prop on screen: the tile under the middle of its box, and its images. */
export interface ShownProp { tx: number; ty: number; images: Phaser.GameObjects.Image[] }

/**
 * Places every standing prop, drawn in order of its box's front edge (one on another prop's top just after that prop),
 * lit by the lamps that reach its footprint and exposed for where it stands; dressing on a wall is hung on it. Returns
 * the floor footprints that shade and block the sun, the props that cast sun shadows, and each prop's images.
 */
export function addProps(
    scene: Phaser.Scene, baker: Baker, walls: Walls, props: PlacedProp[], heights?: Heights
): { occluders: Occluder[]; casters: Caster[]; shown: ShownProp[] } {
    const occluders: Occluder[] = [], casters: Caster[] = [], shown: ShownProp[] = [];
    // What stands on a raised floor is drawn lifted with it, and goes up and down with it as it is cut.
    const lifted: { images: Phaser.GameObjects.Image[]; top: number; tx: number; ty: number; region: number }[] = [];
    const lift = (l: (typeof lifted)[number]) => { for (const image of l.images) image.setY(l.top - heights!.lift(l.tx, l.ty)); };
    heights?.onChange(region => { for (const l of lifted) if (l.region === region) lift(l); });
    props.forEach(({ p, box, art, left, top, under }, i) => {
        const key = `bank-prop-${i}`, depth = DEPTH.standing + drawLine(box, under);
        const lamps = baker.lampsReaching(footprintPoints(box)), exposure = baker.standingAt(box.x + box.w / 2, box.y + box.d / 2);
        const images = [baker.addBaked(key, art.lit, left, top, lamps, EVERYWHERE, exposure).setDepth(depth)];
        casters.push(caster(art.lit, left, top, baseLine(box)));
        if (hasPixels(art.glow)) {
            // Unlit, so without the normal map `addTo` would make.
            if (!scene.textures.exists(`${key}-glow`)) baker.addPixels(`${key}-glow`, art.glow.colors, art.glow.width, art.glow.height);
            images.push(scene.add.image(left, top, `${key}-glow`).setOrigin(0, 0).setDepth(depth + GLOW_DEPTH));
            // A second, additive pass makes screens and lamps glow into the bloom.
            images.push(scene.add.image(left, top, `${key}-glow`).setOrigin(0, 0).setDepth(DEPTH.emissive).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.45));
        }
        const tx = Math.floor((box.x + box.w / 2) / TILE), ty = Math.floor((box.y + box.d / 2) / TILE), region = heights?.region(tx, ty) ?? -1;
        if (region >= 0) {
            lifted.push({ images, top, tx, ty, region });
            lift(lifted.at(-1)!);
        }
        shown.push({ tx, ty, images });
        if (box.z === 0) occluders.push(floorOccluder(box));
        if (box.z > 0 && !isOnTop(p.kind) && !ALWAYS_SHOWN.includes(p.kind)) walls.hang(box, images);
    });
    return { occluders, casters, shown };
}

/**
 * The lights a prop gives off (banker's lamps, screens, the exit sign) as lamps: placed where the art puts them, at
 * Light2D's default height, spreading from the prop's footprint.
 */
function propLamps({ box, art, left, top }: PlacedProp): Lamp[] {
    return art.lights.map(l => ({
        x: left + l.x, y: top + l.y, z: l.radius * 0.1, radius: l.radius, color: l.color, intensity: l.intensity, from: { x: left + l.x, y: box.y + box.d / 2 }
    }));
}

/**
 * Daylight falling through a roof light: a cool, high, wide lamp over the middle of the skylight's patch, so the floor
 * round it is lit like the sky is above it rather than only the pale patch itself.
 */
function skylightLamp(box: Box): Lamp {
    const x = box.x + box.w / 2, y = box.y + box.d / 2;
    return { x, y, z: 44, radius: 112, color: 0xe4ebf8, intensity: 0.6, from: { x, y } };
}

function hasPixels(bitmap: PixelBitmap): boolean {
    for (let y = 0; y < bitmap.height; y++) for (let x = 0; x < bitmap.width; x++) if (bitmap.opaque(x, y)) return true;
    return false;
}

function caster(bitmap: PixelBitmap, left: number, top: number, base: number): Caster {
    return { left, top, width: bitmap.width, height: bitmap.height, base, opaque: (x, y) => bitmap.opaque(x, y) };
}

/** Something standing on the floor shades its footprint and blocks the sun up to its height. */
function floorOccluder(box: Box): Occluder {
    return { x: box.x, y: box.y, w: box.w, h: box.d, height: box.h };
}
