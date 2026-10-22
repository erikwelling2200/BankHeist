import type { Page } from '@playwright/test';

/*
 * Scripted situations in the game (`/?new`), for `npm run shot -- --setup <name>` and the e2e tests: each finds a place
 * in the bank for it on a changed copy of the state, which `window.sim.restart` starts a heist from (resumed by a
 * reload); `then` plays on from there through the page (public `window.sim` commands, the HUD) before the picture.
 * Plain JavaScript in the page, so this file runs under Node's type stripping as well as in Playwright.
 */

/** In the page: helpers for the scripted setups (a free tile, knowing an NPC is there). */
export const PAGE_HELPERS = `
    const sim = window.sim, w = sim.world, same = (a, b) => a.x === b.x && a.y === b.y;
    const clone = s => JSON.parse(JSON.stringify(s));
    const free = (st, p) => p.x >= 0 && p.y >= 0 && p.x < w.width && p.y < w.height && !w.tiles[p.y * w.width + p.x].blocksMove
        && !st.crew.some(c => same(c.pos, p)) && !st.npcs.some(n => n.status !== 'away' && same(n.pos, p));
    const know = (st, n) => { st.knowledge.npcs[n.id] = { at: { ...n.pos }, facing: n.facing, turn: st.turn, live: true, routine: false, rota: false, watched: 1, watchedTurn: st.turn, tick: st.knowledge.phaseTick + 1 }; };
    const AROUND = [{ x: 0, y: 1 }, { x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: -1 }];
`;

/** In the page: an NPC of a role (by a test on it), present; an alarm carrier; the eight tiles round one. */
export const ALARM_HELPERS = `
    const npcOf = (st, test) => st.npcs.find(n => n.status !== 'away' && test(w.people.find(p => p.id === n.id).role));
    const carrier = (st, kind, holder, countdown) => ({ id: 'carrier-e2e', kind, source: holder.id, pos: { ...holder.pos }, countdown, started: { turn: st.turn - 1, phase: 'world' }, halted: null });
    const NEAR = [...AROUND, { x: 1, y: 1 }, { x: -1, y: 1 }, { x: 1, y: -1 }, { x: -1, y: -1 }];
`;

export interface Setup {
    /** What it shows. */
    about: string;
    /** In the page: `{ state, info }` to restart from, or null when this bank has no such place. */
    script: string;
    /** After the reload into the new heist: plays on through the page (`info` is the script's). */
    then?: (page: Page, info: any) => Promise<void>;
}

/** Selects the first crew member (Mara) on the HUD's rail, which brings the camera to her. */
const selectMara = async (page: Page): Promise<void> => {
    await page.locator('.sh-rail .sh-crew').nth(0).click();
};

/** Selects the second crew member (Jun) on the HUD's rail. */
const selectJun = async (page: Page): Promise<void> => {
    await page.locator('.sh-rail .sh-crew').nth(1).click();
};

/** Centres the camera on Mara. */
const lookAtMara = (page: Page): Promise<void> => page.evaluate(() => {
    const p = (window as any).sim.state.crew[0].pos;
    (window as any).game.scene.getScene('bank').lookAt(p.x * 16 + 8, p.y * 16 + 8);
});

/** Mara on a free tile beside a standing NPC the crew sees, one she may knock out, as far from the others as there is. */
const LONE_NPC = `(() => { ${PAGE_HELPERS}
    const present = sim.state.npcs.filter(n => n.status !== 'away');
    const apart = n => Math.min(...present.filter(o => o !== n).map(o => Math.max(Math.abs(o.pos.x - n.pos.x), Math.abs(o.pos.y - n.pos.y))));
    for (const n of [...present].sort((a, b) => apart(b) - apart(a))) {
        for (const d of AROUND) {
            const p = { x: n.pos.x + d.x, y: n.pos.y + d.y }, st = clone(sim.state);
            if (!free(st, p)) continue;
            st.crew[0].pos = p;
            know(st, n);
            if (sim.whyNot({ type: 'knockout', crew: 'mara', npc: n.id }, st) || !sim.knows(n.id, st)) continue;
            return { state: st, info: { npc: n.id, at: p, npcAt: n.pos } };
        }
    }
    return null;
})()`;

export const SETUPS: Record<string, Setup> = {
    'mara-selected': {
        about: 'Mara selected at the van as the heist starts (nothing shows: Clean in Public)',
        script: `(() => { ${PAGE_HELPERS} return { state: clone(sim.state), info: {} }; })()`,
        then: selectMara
    },
    'jun-selected': {
        about: 'Jun selected at the van as the heist starts (his pistol and jammer show: Concealed in Public)',
        script: `(() => { ${PAGE_HELPERS} return { state: clone(sim.state), info: {} }; })()`,
        then: selectJun
    },
    'mara-armed': {
        about: 'Mara selected at the van with a rifle in hand (Armed in Public: unknown risk wherever unseen space sees)',
        script: `(() => { ${PAGE_HELPERS}
            const st = clone(sim.state);
            st.crew[0].loadout.items.push('assaultRifle');
            return { state: st, info: {} };
        })()`,
        then: selectMara
    },
    'beside-guard': {
        about: 'Mara selected on a tile beside a guard the crew sees, unnoticed',
        script: `(() => { ${PAGE_HELPERS} ${ALARM_HELPERS}
            const base = clone(sim.state), guard = npcOf(base, r => /guard|chief/i.test(r));
            if (!guard) return null;
            // Side by side first, where neither stands in front of the other.
            for (const d of [{ x: 1, y: 0 }, { x: -1, y: 0 }, ...NEAR]) {
                const st = clone(base), p = { x: guard.pos.x + d.x, y: guard.pos.y + d.y };
                if (!free(st, p)) continue;
                st.crew[0].pos = p;
                know(st, st.npcs.find(n => n.id === guard.id));
                if (!sim.knows(guard.id, st)) continue;
                return { state: st, info: { guard: guard.id, at: p } };
            }
            return null;
        })()`,
        then: selectMara
    },
    'alarm-countdown': {
        about: 'an alerted guard the crew sees radioing in about Mara: the alarm counts down from 3 in the ledger',
        script: `(() => { ${PAGE_HELPERS} ${ALARM_HELPERS}
            const st = clone(sim.state), guard = npcOf(st, r => /guard|chief/i.test(r));
            if (!guard) return null;
            guard.status = 'alerted'; guard.alerted = true;
            know(st, guard);
            st.carriers.push(carrier(st, 'guardRadio', guard, 3));
            return { state: st, info: { guard: guard.id } };
        })()`,
        then: async page => {
            if (!(await page.locator('.sh-ledger').isVisible())) await page.locator('.sh-ledger-btn').click();
        }
    },
    'panel-half-done': {
        about: 'Mara selected at the alarm panel with 2 of its 4 actions of hacking done (the Disable action shows 2/4)',
        script: `(() => { ${PAGE_HELPERS} ${ALARM_HELPERS}
            const panel = w.objects.find(o => o.kind === 'alarmPanel');
            if (!panel) return null;
            for (const d of [{ x: 0, y: 0 }, ...NEAR]) {
                const p = { x: panel.pos.x + d.x, y: panel.pos.y + d.y }, st = clone(sim.state);
                if (!free(st, p)) continue;
                st.crew[0].pos = p;
                if (!st.crew[0].loadout.items.includes('hackingKit')) st.crew[0].loadout.items.push('hackingKit');
                st.objects[panel.id] = { progress: 2 };
                if (sim.whyNot({ type: 'interact', crew: 'mara', object: panel.id, verb: 'disable' }, st)) continue;
                return { state: st, info: { panel: panel.id } };
            }
            return null;
        })()`,
        then: selectMara
    },
    'dragging-body': {
        about: 'Mara has knocked out the loneliest NPC and drags the body (knockout and drag through window.sim)',
        script: LONE_NPC,
        then: async (page, info: { npc: string }) => {
            await page.evaluate(npc => {
                const sim = (window as any).sim;
                sim.commit({ type: 'knockout', crew: 'mara', npc });
                sim.commit({ type: 'drag', crew: 'mara', npc });
            }, info.npc);
            await selectMara(page);
            await lookAtMara(page);
        }
    }
};
