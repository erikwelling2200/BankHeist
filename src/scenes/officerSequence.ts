import type { OfficerFrame } from '../art/bank/officer';
import { propSize } from '../level/catalog';
import { TILE } from '../level/constants';
import type { LevelProp } from '../level/plan';
import { turned, type Box } from '../level/space';
import { cycle, Timeline, type Cel } from '../logic/timeline';

/**
 * The officer preview's choreography (`?scene=officer`), on a floor of `FLOOR` tiles (from tile `x`, `y`): walk four tiles east and three
 * north, draw and fire twice to the west, dive behind the sofa there and sit with the back against it, then
 * come up on a knee and fire twice over the top. Then it loops.
 *
 * People walk at about 1.4m/s (17.5px/s). Walking east the footing moves 3px a frame, the same as the planted foot
 * slides back in the drawing, so the foot stays put on the floor: 3px every 171ms. Walking north, 4px every 229ms.
 * Every telegraph (the aim before a shot, the glance before coming up) is held at least 450ms, long enough to read.
 */
export const FLOOR = { x: -4, y: -2, w: 18, h: 12 } as const;

/** Where the preview camera looks, at 2x zoom: the middle of the action. */
export const VIEW = { x: 84, y: 82, zoom: 2 } as const;

const WALK_EAST: OfficerFrame[] = ['walkEast0', 'walkEast1', 'walkEast2', 'walkEast3', 'walkEast4', 'walkEast5'];
const WALK_NORTH: OfficerFrame[] = ['walkNorth0', 'walkNorth1', 'walkNorth2', 'walkNorth1'];

export const START: [number, number] = [6.5 * TILE - 63, 7.5 * TILE];

/** The cover: a lobby sofa facing west, towards whoever is shot at; the officer's back lands against its back. */
export const COVER_PROP: LevelProp = { kind: 'sofa', tx: 0, ty: 0 };
const coverSize = turned(propSize(COVER_PROP), 'west');
export const COVER: Box = { x: 69 - coverSize.w, y: 4.5 * TILE - Math.round(coverSize.d / 2), z: 0, ...coverSize, facing: 'west' };

/** A controlled pair: each shot is a flash frame, a recoil held a little longer, then the sight picture back. */
const pair = (aim: OfficerFrame, kick: OfficerFrame): Cel<OfficerFrame>[] => [
    { frame: kick, ms: 67, cue: 'shot' }, { frame: kick, ms: 83 }, { frame: aim, ms: 270 },
    { frame: kick, ms: 67, cue: 'shot' }, { frame: kick, ms: 83 }, { frame: aim, ms: 350 }
];

export const OFFICER_CELS: Cel<OfficerFrame>[] = [
    { frame: 'standEast', ms: 700 },
    ...cycle(WALK_EAST, 171, 21, { step: [3, 0] }),
    { frame: 'standEast', ms: 180 },
    ...cycle(WALK_NORTH, 229, 12, { glide: [0, -4] }),
    { frame: 'standNorth', ms: 260 },
    { frame: 'standWest', ms: 220 },

    // The draw: the hand on the holster is held as the tell, then a held aim telegraphs the shots.
    { frame: 'drawWest0', ms: 300 },
    { frame: 'drawWest1', ms: 100 },
    { frame: 'drawWest2', ms: 90 },
    { frame: 'aimWest', ms: 450 },
    ...pair('aimWest', 'kickWest'),

    // The dive: a crouch to wind up, a fast flight, a long slide, and a spin to put the back to the boxes.
    { frame: 'crouchWest', ms: 160 },
    { frame: 'launchWest', ms: 70, step: [-4, 0] },
    { frame: 'flyWest', ms: 80, step: [-6, 0] },
    { frame: 'flyWest', ms: 70, step: [-5, 0] },
    { frame: 'landWest', ms: 80, step: [-5, 0], cue: 'land' },
    { frame: 'landWest', ms: 150, glide: [-4, 0] },
    // Hands at the sofa: a shuffle back and round, so the back comes to rest against it.
    { frame: 'turnSouth', ms: 130, step: [-7, 0] },
    { frame: 'coverEast', ms: 650 },
    { frame: 'coverEastBreath', ms: 350 },
    { frame: 'coverEast', ms: 350 },
    { frame: 'coverEastBreath', ms: 350 },
    // A glance over the shoulder telegraphs coming up.
    { frame: 'coverEastLook', ms: 550 },
    { frame: 'kneelWest', ms: 130 },
    { frame: 'riseWest', ms: 110 },
    { frame: 'overAimWest', ms: 450 },
    ...pair('overAimWest', 'overKickWest'),
    // Duck back down behind the sofa and hold before the loop fades.
    { frame: 'riseWest', ms: 100 },
    { frame: 'kneelWest', ms: 700 }
];

export const officerTimeline = (): Timeline<OfficerFrame> => new Timeline(OFFICER_CELS, START);

/** How long the loop fades through black at each end, in ms. */
export const FADE_MS = 300;
