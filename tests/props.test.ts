import { describe, expect, it } from 'vitest';
import { propArt } from '../src/art/bank/props';
import { Turn, View } from '../src/art/bank/view';
import { CATALOG, isOnTop, propBox, propSize } from '../src/level/catalog';
import { BANK_PROPS } from '../src/level/bank';
import { TILE } from '../src/level/constants';
import type { LevelProp } from '../src/level/plan';
import { baseLine, boxesOverlap, drawLine, FACINGS, frontRow, PERSON_SIZE, place, px, supportOf, topRows, turned } from '../src/level/space';

const RED = 0xff0000, BLUE = 0x0000ff, GREY = 0x808080;
const FLAT: LevelProp['kind'][] = ['mat', 'manhole', 'floorGrate', 'skylight'];

describe('hand-drawn props', () => {
    const kinds = new Map(BANK_PROPS.map(p => [p.kind, p]));
    // Every kind in the catalog, whether or not the example bank uses it (a generated bank may).
    for (const kind of Object.keys(CATALOG) as LevelProp['kind'][]) if (!kinds.has(kind)) kinds.set(kind, { kind, tx: 0, ty: 0 } as LevelProp);

    it('draws every kind in the catalog facing all four ways, each view standing on its turned footprint', () => {
        for (const p of kinds.values()) for (const facing of FACINGS) {
            const size = propSize(p), art = propArt(p, size, facing), footprint = turned(size, facing);
            const label = `${p.kind} facing ${facing}`;
            // Margins are even on both sides, so the footprint stays centred under whatever reaches past it.
            expect(art.lit.width - art.originX * 2, label).toBe(footprint.w);
            const rows = FLAT.includes(p.kind) || p.kind === 'queueRail' ? footprint.d + size.h : topRows(footprint.d) + size.h;
            expect(art.lit.height, label).toBeGreaterThanOrEqual(rows);
            let drawn = 0;
            for (let y = 0; y < art.lit.height; y++) for (let x = 0; x < art.lit.width; x++) if (art.lit.opaque(x, y) || art.glow.opaque(x, y)) drawn++;
            expect(drawn, label).toBeGreaterThan(0);
        }
    });

    it('shows a different side of the asymmetric props from each direction', () => {
        for (const kind of ['counter', 'sofa', 'filingCabinet', 'hydrant', 'camera', 'plant', 'coatStand', 'cleaningTrolley', 'monitor', 'microwave', 'cake'] as const) {
            const p = kinds.get(kind)!, size = propSize(p);
            const [south, north] = [propArt(p, size, 'south'), propArt(p, size, 'north')];
            expect(south.lit.colors, kind).not.toEqual(north.lit.colors);
        }
    });
});

describe('second-tier props', () => {
    const ON_TOP: LevelProp['kind'][] = ['monitor', 'deskLamp', 'paperStack', 'mug', 'photoFrame', 'cashCounter', 'microwave', 'cake'];
    const at = (kind: LevelProp['kind'], extra: Partial<LevelProp> = {}) => ({ kind, tx: 0, ty: 0, ...extra }) as LevelProp;

    it('marks exactly the things that stand on another prop, and sizes them at their real size', () => {
        expect((Object.keys(CATALOG) as LevelProp['kind'][]).filter(isOnTop).sort()).toEqual([...ON_TOP].sort());
        expect(propSize(at('monitor'))).toEqual({ w: px(0.55), d: px(0.2), h: px(0.45) });
        expect(propSize(at('microwave'))).toEqual({ w: px(0.5), d: px(0.35), h: px(0.3) });
        expect(propSize(at('cashCounter'))).toEqual({ w: px(0.3), d: px(0.3), h: px(0.25) });
        // Small things stay small: a mug is a couple of pixels, under a monitor.
        expect(propSize(at('mug')).w).toBeLessThanOrEqual(2);
        for (const kind of ON_TOP) expect(propSize(at(kind)).h, kind).toBeLessThan(propSize(at('monitor')).h + 1);
    });

    it('needs the elevation of the top it stands on', () => {
        for (const kind of ON_TOP) {
            expect(() => propBox(at(kind), []), kind).toThrow(/stands on another prop/);
            expect(propBox(at(kind, { elevation: px(0.75) }), []).z, kind).toBe(px(0.75));
        }
        // Wall dressing keeps its catalog elevation unless the level says otherwise.
        expect(propBox(at('whiteboard'), []).z).toBe(px(0.95));
        expect(propBox(at('whiteboard', { elevation: px(1.0) }), []).z).toBe(px(1.0));
    });

    // The tops second-tier props stand on: a desk and a meeting table (0.75m), the kitchen counter (0.9m) and the teller
    // counter (1.2m), each with things placed on the same tiles the way a level would.
    const supports = [
        { under: at('desk'), span: [2, 1] as [number, number], align: {} },
        { under: at('meetingTable'), span: [3, 1] as [number, number], align: {} },
        { under: at('kitchenCounter'), span: [2, 1] as [number, number], align: { alignY: 'north' as const } },
        {
            under: { kind: 'counter', tx: 0, ty: 0, width: 2, stations: [0], closed: [], gate: 1 } as LevelProp, span: [2, 1] as [number, number],
            align: { alignX: 'west' as const, alignY: 'north' as const }
        }
    ];

    it('stands on a desk, a table or a counter, inside its top and clear of it', () => {
        for (const { under, span, align } of supports) for (const facing of FACINGS) {
            const support = propBox({ ...under, facing }, []);
            for (const kind of ON_TOP) {
                const box = propBox(at(kind, { span, facing, elevation: support.h, ...align }), []);
                const label = `${kind} on ${under.kind} facing ${facing}`;
                expect(boxesOverlap(box, support), label).toBe(false);
                expect(supportOf(box, [support]), label).toBe(support);
                // Drawn on the support's top as the support draws it: tops are foreshortened.
                const row = frontRow(box, support);
                expect(row, label).toBeLessThanOrEqual(baseLine(support) - support.h);
                expect(row, label).toBeGreaterThanOrEqual(baseLine(support) - support.h - topRows(support.d));
            }
        }
    });

    it('finds nothing to stand on beside or above a desk', () => {
        const desk = propBox(at('desk'), []);
        expect(() => supportOf({ ...desk, x: desk.x + desk.w, w: 2, d: 2, z: desk.h }, [desk])).toThrow(/Nothing under/);
        expect(() => supportOf({ ...desk, w: 2, d: 2, z: desk.h + 1 }, [desk])).toThrow(/Nothing under/);
    });

    it('draws after the desk under it, back to front along its top, and before anyone in front of the desk', () => {
        const desk = propBox(at('desk', { tx: 3, ty: 4 }), []);
        const back = propBox(at('monitor', { tx: 3, ty: 4, span: [2, 1], elevation: desk.h, alignY: 'center' }), []);
        const front = { ...back, y: desk.y + desk.d - back.d };
        const person = place({ tx: 3, ty: 5 }, PERSON_SIZE), behind = place({ tx: 3, ty: 3 }, PERSON_SIZE);
        expect(drawLine(back, desk)).toBeGreaterThan(drawLine(desk));
        expect(drawLine(front, desk)).toBeGreaterThan(drawLine(back, desk));
        expect(drawLine(front, desk)).toBeLessThan(baseLine(desk) + 1);
        expect(baseLine(person)).toBeGreaterThan(drawLine(front, desk));
        expect(baseLine(behind)).toBeLessThan(drawLine(back, desk));
    });
});

describe('the floor and wall props for rooms with a story', () => {
    it('sizes them at real scale and fits them in their tiles', () => {
        const table = propBox({ kind: 'meetingTable', tx: 0, ty: 0 }, []);
        expect(table.w).toBeLessThanOrEqual(3 * TILE);
        expect(table.d).toBeLessThanOrEqual(TILE);
        // A meeting table is a desk's height, so the same chairs and things on top fit it.
        expect(table.h).toBe(propSize({ kind: 'desk', tx: 0, ty: 0 }).h);
        for (const kind of ['coatStand', 'cashBags', 'cleaningTrolley', 'wetFloorSign', 'whiteboard'] as const) {
            const box = propBox({ kind, tx: 0, ty: 0 }, []);
            expect(box.w, kind).toBeLessThanOrEqual(TILE);
            expect(box.d, kind).toBeLessThanOrEqual(TILE);
        }
        // A coat stand is about a person's height; the whiteboard hangs below where full walls are cut.
        expect(Math.abs(propSize({ kind: 'coatStand', tx: 0, ty: 0 }).h - PERSON_SIZE.h)).toBeLessThanOrEqual(2);
        const board = propBox({ kind: 'whiteboard', tx: 0, ty: 0 }, []);
        expect(board.z + board.h).toBeLessThanOrEqual(px(1.92));
    });
});

describe('drawing parts in a view', () => {
    const tiered = (facing: 'south' | 'north') => {
        // A tall block at the back, a low one in front of it.
        const size = { w: 4, d: 4, h: 6 }, t = new Turn(size, facing), view = new View(t.w, t.d, size.h);
        t.draw(view, [
            [{ x: 0, y: 2, z: 0, w: 4, d: 2, h: 2 }, { sides: RED, top: RED }],
            [{ x: 0, y: 0, z: 0, w: 4, d: 2, h: 6 }, { sides: BLUE, top: BLUE }]
        ]);
        return view.lit;
    };

    it('lets a nearer part cover a further one, whichever way the prop faces', () => {
        const south = tiered('south');
        expect(south.color(1, south.height - 1)).toBe(RED);
        expect(south.color(1, 0)).toBe(BLUE);
        const north = tiered('north');
        for (let y = 0; y < north.height; y++) if (north.opaque(1, y)) expect(north.color(1, y)).not.toBe(RED);
    });

    it('draws a part after the part it stands on', () => {
        const size = { w: 6, d: 6, h: 4 }, t = new Turn(size, 'south'), view = new View(t.w, t.d, size.h, { headroom: 2 });
        t.draw(view, [
            [{ x: 1, y: 1, z: 2, w: 2, d: 2, h: 2 }, { sides: RED, top: RED }],
            [{ x: 0, y: 0, z: 0, w: 6, d: 6, h: 2 }, { sides: GREY, top: GREY }]
        ]);
        let red = 0;
        for (let y = 0; y < view.lit.height; y++) for (let x = 0; x < view.lit.width; x++) if (view.lit.color(x, y) === RED) red++;
        expect(red).toBeGreaterThanOrEqual(2 * 2 + 2);
    });

    it('turns an own-frame point and its lights with the facing', () => {
        const size = { w: 6, d: 3, h: 2 };
        expect(new Turn(size, 'south').point(1, 0)).toEqual([1, 0]);
        expect(new Turn(size, 'north').point(1, 0)).toEqual([5, 3]);
        expect(new Turn(size, 'east').point(1, 0)).toEqual([0, 5]);
        expect(new Turn(size, 'west').point(1, 0)).toEqual([3, 1]);
    });
});
