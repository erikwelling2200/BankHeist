import { describe, expect, it } from 'vitest';
import { drawPose, joint, OFFICER_FRAME, OFFICER_FRAMES, OFFICER_POSES, type OfficerFrame } from '../src/art/bank/officer';
import { boxesOverlap } from '../src/level/space';
import { TILE } from '../src/level/constants';
import { cycle, Timeline } from '../src/logic/timeline';
import { COVER, OFFICER_CELS, officerTimeline, START } from '../src/scenes/officerSequence';

describe('timeline', () => {
    const t = new Timeline([{ frame: 'a', ms: 100, step: [3, 0] }, { frame: 'b', ms: 200, glide: [0, -8] }, { frame: 'c', ms: 100 }], [10, 20]);

    it('steps as a cel comes up, glides while it shows, and loops', () => {
        expect(t.duration).toBe(400);
        expect(t.at(0)).toEqual({ index: 0, frame: 'a', x: 13, y: 20 });
        expect(t.at(200)).toEqual({ index: 1, frame: 'b', x: 13, y: 16 });
        expect(t.at(399)).toMatchObject({ frame: 'c', x: 13, y: 12 });
        expect(t.at(400)).toEqual(t.at(0));
        expect(t.end).toEqual([13, 12]);
    });

    it('repeats a cycle of frames', () => {
        expect(cycle(['x', 'y'], 50, 3, { step: [1, 0] }).map(c => c.frame)).toEqual(['x', 'y', 'x']);
    });
});

describe('the officer', () => {
    it('bends a joint towards the side it is asked to, and stretches a limb that cannot reach', () => {
        const knee = joint([0, 0], [0, 5], 3.5, 3.5, [1, 0]);
        expect(knee[0]).toBeGreaterThan(1);
        expect(joint([0, 0], [0, 9], 3.5, 3.5, [1, 0])).toEqual([0, 4.5]);
    });

    it('draws every frame inside its canvas, standing on the footing row', () => {
        for (const name of OFFICER_FRAMES) {
            const b = drawPose(OFFICER_POSES[name]);
            expect(b.width, name).toBe(OFFICER_FRAME.width);
            let lowest = -1;
            for (let y = 0; y < b.height; y++) for (let x = 0; x < b.width; x++) if (b.opaque(x, y)) lowest = y;
            expect(lowest, name).toBeLessThanOrEqual(OFFICER_FRAME.anchorY);
        }
    });

    it('keeps the planted foot on its floor pixel through the walk east', () => {
        // The footing moves 3px a frame; the foot on the floor must slide back 3px in the drawing.
        const walk: OfficerFrame[] = ['walkEast0', 'walkEast1', 'walkEast2', 'walkEast3', 'walkEast4', 'walkEast5'];
        const step = OFFICER_CELS.find(c => c.frame === 'walkEast1')!.step![0];
        walk.forEach((name, i) => {
            const next = OFFICER_POSES[walk[(i + 1) % walk.length]!];
            const planted = [0, 1].filter(f => OFFICER_POSES[name].feet[f]![1] === 0 && next.feet[f]![1] === 0);
            expect(planted.length, name).toBeGreaterThan(0);
            for (const f of planted) expect(next.feet[f]![0] + step, `${name} foot ${f}`).toBe(OFFICER_POSES[name].feet[f]![0]);
        });
    });
});

describe('the preview sequence', () => {
    const timeline = officerTimeline();

    it('walks four tiles east, then three north, ending on tile centres', () => {
        const east = OFFICER_CELS.findIndex(c => c.frame === 'walkNorth0');
        expect(timeline.originOf(east)[0] - START[0]).toBe(63);
        expect(timeline.originOf(east)[0]).toBe(6.5 * TILE);
        const west = OFFICER_CELS.findIndex(c => c.frame === 'standWest');
        expect(timeline.originOf(west)).toEqual([6.5 * TILE, 4.5 * TILE]);
    });

    it('fires twice standing and twice over the cover, each after an aim held long enough to read', () => {
        const shots = OFFICER_CELS.map((c, i) => [c, i] as const).filter(([c]) => c.cue === 'shot');
        expect(shots.map(([c]) => c.frame)).toEqual(['kickWest', 'kickWest', 'overKickWest', 'overKickWest']);
        for (const i of [shots[0]![1], shots[2]![1]]) expect(OFFICER_CELS[i - 1]!.ms).toBeGreaterThanOrEqual(400);
    });

    it('lands with the back against the cover, beside it and not inside it', () => {
        const sit = OFFICER_CELS.findIndex(c => c.frame === 'coverEast');
        const [x, y] = timeline.originOf(sit);
        const bitmap = drawPose(OFFICER_POSES.coverEast);
        let back = Infinity;
        for (let py = 0; py < bitmap.height; py++) for (let px = 0; px < bitmap.width; px++) if (bitmap.opaque(px, py)) back = Math.min(back, px);
        // The back's outermost pixel is the one just east of the sofa.
        expect(x - OFFICER_FRAME.anchorX + back).toBe(COVER.x + COVER.w);
        expect(y).toBeGreaterThan(COVER.y);
        expect(y).toBeLessThan(COVER.y + COVER.d);
        const body = { x: x - 2, y: y - 2, z: 0, w: 5, d: 4, h: 12, facing: 'east' as const };
        expect(boxesOverlap(body, COVER)).toBe(false);
    });
});
