import { describe, expect, it } from 'vitest';
import { propArt } from '../src/art/bank/props';
import { Turn, View } from '../src/art/bank/view';
import { propSize } from '../src/level/catalog';
import { LOBBY_PROPS, type LobbyProp } from '../src/level/lobby';
import { FACINGS, topRows, turned } from '../src/level/space';

const RED = 0xff0000, BLUE = 0x0000ff, GREY = 0x808080;
const FLAT: LobbyProp['kind'][] = ['mat', 'manhole'];

describe('hand-drawn props', () => {
    const kinds = new Map(LOBBY_PROPS.map(p => [p.kind, p]));

    it('draws every kind in the lobby facing all four ways, each view standing on its turned footprint', () => {
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
        for (const kind of ['counter', 'sofa', 'filingCabinet', 'hydrant', 'camera', 'plant'] as const) {
            const p = kinds.get(kind)!, size = propSize(p);
            const [south, north] = [propArt(p, size, 'south'), propArt(p, size, 'north')];
            expect(south.lit.colors, kind).not.toEqual(north.lit.colors);
        }
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
