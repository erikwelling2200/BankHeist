import { Rng } from '../gen/rng';
import { THRESHOLDS } from './squeeze';

/*
 * The complications the Squeeze lands (GAME_DESIGN §19.2): drawn from the pool when the campaign starts, so their
 * order is fixed and the whole timeline can be shown from day 1. What each does to the finale is the finale's (M7):
 * here they are named, ordered and landed.
 */

export type ComplicationId =
    | 'guardPosts' | 'policeEta' | 'vaultUpgrade' | 'securityChief' | 'cameraNetwork'
    | 'taskForce' | 'nervousFence' | 'checkpoint' | 'snitch' | 'responseTeam';

/** The pool, in §19.2's order: what each is called and what it does. */
export const COMPLICATIONS: Readonly<Record<ComplicationId, { name: string; text: string }>> = {
    guardPosts: { name: 'Extra guard posts', text: 'The depot adds 2 guard posts.' },
    policeEta: { name: 'New police contract', text: 'The police response contract is renegotiated: finale police ETA −1.' },
    vaultUpgrade: { name: 'Vault upgrade', text: 'The vault is upgraded: drill time +4, or a second sensor.' },
    securityChief: { name: 'New security chief', text: 'A security chief transfers in and recognises any crew member with Notoriety 1+.' },
    cameraNetwork: { name: 'Camera network', text: 'The camera network is upgraded: every feed is live, and a second operator is added.' },
    taskForce: { name: 'Task force tail', text: 'The task force tails the crew: Notoriety +2 for the crew member with the most.' },
    nervousFence: { name: 'Nervous fence', text: 'The fence gets nervous: fence cut +15%.' },
    checkpoint: { name: 'City checkpoint', text: 'A city checkpoint closes one finale getaway route.' },
    snitch: { name: 'Snitch', text: 'A snitch burns one finale advantage, chosen at random from those not yet used.' },
    responseTeam: { name: 'Response team doubles', text: 'The armed response team doubles.' }
};

export const COMPLICATION_IDS = Object.keys(COMPLICATIONS) as ComplicationId[];

/** The campaign's complications in the order they land, one per threshold before the Raid: the same for the same seed. */
export function drawComplications(seed: number): ComplicationId[] {
    return new Rng(seed).fork('complications').shuffle(COMPLICATION_IDS).slice(0, THRESHOLDS.length);
}
