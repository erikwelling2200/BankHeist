import { frontRow } from './build';
import type { Furnisher } from './furnish';
import type { GenRoom, Headline, RoomType } from './model';
import type { Plot } from './plot';
import type { Rng } from './rng';
import type { Site } from './site';

/*
 * Headline features that change the building beyond what the archetype and the neighbours already do (§17.6): a
 * drive-through teller lane on the side road or the back lot, and the many exits of a bank in a mall. (The atrium's
 * skylight, the mezzanine CCTV room, the scaffolding next door and the old bank's walls are built where those are.)
 */

/** Rooms the drive-through window may open from, best first. */
const DRIVE_ROOMS: RoomType[] = ['atmRoom', 'breakRoom', 'staffOffice', 'managerOffice', 'conferenceRoom', 'recordsRoom', 'cleanersCloset'];
export function buildFeatures(site: Site, plot: Plot, bank: GenRoom[], headlines: Headline[], rng: Rng, frontDoorX: number, furnish: Furnisher): { window?: { x: number; y: number } } {
    const out: { window?: { x: number; y: number } } = {};
    const east = plot.lot.x + plot.lot.w;
    if (headlines.includes('driveThrough') && plot.side) {
        // A two-tile teller window in the bank's east wall, onto the lane, from a staff room wide enough for its desk
        // and the teller behind it (a corridor would be blocked), best first; the tube terminal on its island.
        const rooms = bank.filter(r => r.x + r.w === east && r.w >= 3 && r.h >= 2 && DRIVE_ROOMS.includes(r.type)).sort((a, b) => DRIVE_ROOMS.indexOf(a.type) - DRIVE_ROOMS.indexOf(b.type));
        for (const room of rooms) {
            // Two rows of the room along the lane, as near its middle as its shape allows.
            const rows = site.tilesOfRoom(room).filter(t => t.x === east - 1 && site.roomAt(east - 2, t.y) === room && site.roomAt(east - 1, t.y + 1) === room).map(t => t.y);
            const mid = room.y + Math.floor((room.h - 1) / 2), y = rows.sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid))[0];
            if (y === undefined) continue;
            const edges = [y, y + 1].map(ty => ({ run: 'northSouth' as const, tx: east, ty }));
            if (!edges.every(e => site.wallAt(e)?.kind === 'brick' || site.wallAt(e)?.kind === 'plaster')) continue;
            if (!furnish.canStand(east - 2, y)) continue;
            // The window first: it is thicker than the wall it replaces, and the counter stands against its face.
            const before = edges.map(e => site.wallAt(e)!.kind);
            for (const e of edges) site.setWall(e, 'tellerWindow');
            if (!furnish.try({ kind: 'backCounter', tx: east - 1, ty: y, width: 2, facing: 'west', alignX: 'east' }, room)) {
                edges.forEach((e, i) => site.setWall(e, before[i]!));
                continue;
            }
            furnish.try({ kind: 'tubeTerminal', tx: east + 2, ty: y });
            out.window = { x: east - 1, y };
            break;
        }
    }
    if (headlines.includes('mallBank')) {
        // A second pair of glass doors in the lobby's front, for the crowds.
        const y = plot.lot.y + plot.lot.h, lobby = site.roomAt(frontDoorX, y - 1)!, row = frontRow(site, lobby);
        const options = [row.x + 1, row.x + row.w - 3].filter(x => Math.abs(x - frontDoorX) >= 4);
        const x = options.length ? rng.pick(options) : undefined;
        if (x !== undefined) {
            const street = site.roomAt(x, y)!;
            site.setWall({ run: 'eastWest', tx: x, ty: y }, 'doorGlass');
            site.setWall({ run: 'eastWest', tx: x + 1, ty: y }, 'doorGlass');
            site.addDoor(lobby, street, { run: 'eastWest', tx: x, ty: y }, 'none', 'doorGlass');
        }
    }
    return out;
}
