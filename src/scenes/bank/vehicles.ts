import type Phaser from 'phaser';
import { propArt } from '../../art/bank/props';
import type { BankData } from '../../level/bankData';
import { propBox, propSize } from '../../level/catalog';
import type { LevelProp } from '../../level/plan';
import { drawLine, frontRow } from '../../level/space';
import type { DeepReadonly, Heading, VehicleState } from '../../sim';
import { EVERYWHERE, footprintPoints, type Baker } from './bake';
import { DEPTH } from './layers';
import type { ShownProp } from './props';

/** The level's name for each heading a vehicle can have. */
const FACING: Readonly<Record<Heading, 'north' | 'east' | 'south' | 'west'>> = { n: 'north', e: 'east', s: 'south', w: 'west' };

/**
 * The crew's vehicles as the state has them (M3-08): drawn where the generator parked them until they move, then baked
 * afresh for each place and heading they stop at (lit by the lamps that reach them there), and hidden once gone. The
 * drive itself isn't animated yet (M3-09's driving overlay); its swept path is the sim's `driven` event.
 */
export class Vehicles {
    private shownAt = new Map<string, string>();
    private drawn = new Map<string, Phaser.GameObjects.Image[]>();

    /** `built`: each vehicle's images as the bank was drawn, by id. */
    constructor(private readonly baker: Baker, private readonly bank: BankData, built: ReadonlyMap<string, ShownProp>) {
        for (const [id, shown] of built) this.drawn.set(id, shown.images);
    }

    /** Draws each vehicle where it stands now (`start` is where it was built: its own images stay). */
    sync(vehicles: DeepReadonly<Record<string, VehicleState>>, start: (id: string) => DeepReadonly<VehicleState['pose']> | undefined): void {
        for (const [id, v] of Object.entries(vehicles)) {
            const home = start(id), key = v.gone ? 'gone' : `${v.pose.x},${v.pose.y},${v.pose.heading}`;
            if ((this.shownAt.get(id) ?? (home ? `${home.x},${home.y},${home.heading}` : '')) === key) continue;
            this.shownAt.set(id, key);
            for (const image of this.drawn.get(id) ?? []) image.destroy();
            this.drawn.set(id, v.gone ? [] : [this.draw(id, v.pose)]);
        }
    }

    private draw(id: string, pose: DeepReadonly<VehicleState['pose']>): Phaser.GameObjects.Image {
        const p: LevelProp = { kind: 'van', tx: pose.x, ty: pose.y, facing: FACING[pose.heading] } as LevelProp;
        const box = propBox(p, this.bank.level.walls), art = propArt(p, propSize(p), box.facing);
        const left = box.x - art.originX, top = frontRow(box) - art.lit.height;
        const lamps = this.baker.lampsReaching(footprintPoints(box)), exposure = this.baker.standingAt(box.x + box.w / 2, box.y + box.d / 2);
        const key = `bank-vehicle-${id}-${pose.x}-${pose.y}-${pose.heading}`;
        return this.baker.addBaked(key, art.lit, left, top, lamps, EVERYWHERE, exposure).setDepth(DEPTH.standing + drawLine(box));
    }
}
