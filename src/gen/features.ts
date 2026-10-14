import type { Furnisher } from './furnish';
import type { GenRoom, Headline } from './model';
import type { Plot } from './plot';
import type { Rng } from './rng';
import type { Site } from './site';

/*
 * Headline features that change the building beyond what the archetype and the neighbours already do (§17.6): a
 * drive-through teller lane on the side road or the back lot, and the many exits of a bank in a mall. (The atrium's
 * skylight, the mezzanine CCTV room, the scaffolding next door and the old bank's walls are built where those are.)
 */
export function buildFeatures(site: Site, plot: Plot, bank: GenRoom[], headlines: Headline[], rng: Rng, frontDoorX: number, furnish: Furnisher): { window?: { x: number; y: number } } {
    const out: { window?: { x: number; y: number } } = {};
    const east = plot.lot.x + plot.lot.w;
    if (headlines.includes('driveThrough') && plot.side) {
        // A teller window in the bank's east wall, onto the lane, from the first staff room along it.
        const rooms = bank.filter(r => r.x + r.w === east && (r.type === 'atmRoom' || r.type === 'breakRoom' || r.type === 'tellerLine' || r.type === 'managerOffice' || r.type === 'staffCorridor'));
        for (const room of rng.shuffle(rooms)) {
            const y = room.y + Math.floor(room.h / 2), e = { run: 'northSouth' as const, tx: east, ty: y };
            const kind = site.wallAt(e)?.kind;
            if (kind !== 'brick' && kind !== 'plaster') continue;
            site.setWall(e, 'tellerWindow');
            furnish.try({ kind: 'tubeTerminal', tx: east + 2, ty: y });
            out.window = { x: east - 1, y };
            break;
        }
    }
    if (headlines.includes('mallBank')) {
        // A second pair of glass doors in the lobby's front, for the crowds.
        const y = plot.lot.y + plot.lot.h, lobby = site.roomAt(frontDoorX, y - 1)!;
        const options = [lobby.x + 1, lobby.x + lobby.w - 3].filter(x => Math.abs(x - frontDoorX) >= 4);
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
