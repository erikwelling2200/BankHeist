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

/** Mara on a free tile beside a guard, the crew knowing the guard is there. */
const BESIDE_GUARD = `(() => { ${PAGE_HELPERS} ${ALARM_HELPERS}
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
})()`;

/**
 * A scene for the safe floor (§8.8): Mara two tiles from an NPC the crew sees, with the bank scouted round her, armed or
 * not, wherever her Move band shows the most kinds of tile (green, amber, red, hatched, a challenge).
 */
export const SAFE_FLOOR_SETUP = `(() => { ${PAGE_HELPERS}
    const cheb = (p, q) => Math.max(Math.abs(p.x - q.x), Math.abs(p.y - q.y));
    const ABC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    const scout = (st, at, r) => {
        let s = '';
        for (let i = 0; i < w.width * w.height; i += 6) {
            let v = 0;
            for (let j = 0; j < 6 && i + j < w.width * w.height; j++) if (cheb({ x: (i + j) % w.width, y: Math.floor((i + j) / w.width) }, at) <= r) v |= 1 << j;
            s += ABC[v];
        }
        st.knowledge.seen = st.knowledge.fresh = s;
    };
    const present = sim.state.npcs.filter(n => n.status !== 'away');
    const OUT = [{ x: 0, y: 2 }, { x: 2, y: 0 }, { x: -2, y: 0 }, { x: 0, y: -2 }, { x: 2, y: 2 }, { x: -2, y: 2 }];
    let best = null;
    for (const n of present) for (const item of [null, 'pistol', 'assaultRifle']) for (const d of OUT) {
        const p = { x: n.pos.x + d.x, y: n.pos.y + d.y }, st = clone(sim.state);
        if (!free(st, p)) continue;
        st.crew[0].pos = p;
        st.crew[1].pos = { ...sim.state.crew[1].pos };
        if (item) st.crew[0].loadout.items.push(item);
        for (const o of present) if (cheb(o.pos, p) <= 7) know(st, o);
        scout(st, p, 7);
        const floor = sim.safeFloor('mara', ['stay', 'move'], st), kinds = new Set();
        for (const t of floor.tiles) if (t.band === 'move') kinds.add(t.tint.kind + (t.tint.hatched ? ' hatched' : ''));
        const WEIGHT = { safe: 1, red: 1, amber: 4, trespass: 2, camera: 2 };
        // Room to show it: a few points for a wide Move band.
        const score = [...kinds].reduce((n, k) => n + (k.endsWith('hatched') ? 3 : WEIGHT[k] ?? 0), 0) + Math.min(floor.tiles.length, 40) / 10;
        if (!kinds.has('safe') || !(kinds.has('red') || kinds.has('camera'))) continue;
        if (!best || score > best.score) best = { score, st, info: { npc: n.id, npcAt: n.pos, at: p, kinds: [...kinds] } };
    }
    return best && { state: best.st, info: best.info };
})()`;

/** Jun armed with a rifle, the bank scouted 5 tiles round him and nothing beyond: unknown risk all round his Move band. */
export const HATCHED_SETUP = `(() => { ${PAGE_HELPERS}
    const ABC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/', st = clone(sim.state), at = st.crew[1].pos;
    st.crew[1].loadout.items.push('assaultRifle');
    let s = '';
    for (let i = 0; i < w.width * w.height; i += 6) {
        let v = 0;
        for (let j = 0; j < 6 && i + j < w.width * w.height; j++) {
            const x = (i + j) % w.width, y = Math.floor((i + j) / w.width);
            if (Math.max(Math.abs(x - at.x), Math.abs(y - at.y)) <= 5) v |= 1 << j;
        }
        s += ABC[v];
    }
    st.knowledge.seen = st.knowledge.fresh = s;
    return { state: st, info: { at } };
})()`;

/** Waits until the camera holds still (it eases to what was just selected), so a tile's place on the page is fixed. */
const settle = async (page: Page): Promise<void> => {
    const at = () => page.evaluate(() => { const d = (window as any).game.scene.getScene('bank').debugState; return `${d.midX},${d.midY},${d.zoom}`; });
    await page.waitForFunction(() => (window as any).game.scene.getScene('bank').debugState.play?.floorDash);
    for (let a = await at(), i = 0; i < 40; i++) {
        await page.waitForTimeout(120);
        const b = await at();
        if (a === b) return;
        a = b;
    }
};

/** Where tile p is on the page. */
const onPage = (page: Page, p: { x: number; y: number }): Promise<{ x: number; y: number }> =>
    page.evaluate(([x, y]) => (window as any).game.scene.getScene('bank').tileOnPage(x, y), [p.x, p.y]);

/** Taps tile p (a preview of a Move or Dash there). */
const tapTile = async (page: Page, p: { x: number; y: number }): Promise<void> => {
    const at = await onPage(page, p);
    await page.mouse.click(at.x, at.y);
};

/** Holds tile p ("who and why"). */
const holdTile = async (page: Page, p: { x: number; y: number }): Promise<void> => {
    const at = await onPage(page, p);
    await page.mouse.move(at.x, at.y + 5);
    await page.waitForTimeout(100);
    await page.mouse.down();
    await page.waitForTimeout(700);
    await page.mouse.up();
};

/** Jun in the lobby a few tiles east of the queue of customers, the crew knowing who stands round him. */
const JUN_BY_QUEUE = `(() => { ${PAGE_HELPERS}
    const base = clone(sim.state), queue = base.npcs.filter(n => n.status !== 'away' && /customer/.test(w.people.find(p => p.id === n.id).role));
    if (!queue.length) return null;
    const qx = Math.max(...queue.map(n => n.pos.x)), qy = Math.round(queue.reduce((s, n) => s + n.pos.y, 0) / queue.length);
    for (const d of [{ x: 3, y: 1 }, { x: 3, y: 0 }, { x: 4, y: 1 }, { x: 3, y: 2 }, { x: 4, y: 0 }, { x: 4, y: 2 }]) {
        const st = clone(base), p = { x: qx + d.x, y: qy + d.y };
        if (!free(st, p)) continue;
        st.crew[1].pos = p;
        for (const n of st.npcs) if (n.status !== 'away' && Math.max(Math.abs(n.pos.x - p.x), Math.abs(n.pos.y - p.y)) <= 9) know(st, n);
        return { state: st, info: { at: p, queueX: Math.min(...queue.map(n => n.pos.x)), queueY: qy } };
    }
    return null;
})()`;

/** Mara in the lobby beside the lobby guard with a rifle (Armed: whoever sees her reacts), knowing who stands round her. */
const NEAR_LOBBY_GUARD = `(() => { ${PAGE_HELPERS}
    const base = clone(sim.state), guard = base.npcs.find(n => n.status !== 'away' && /lobbyGuard/.test(w.people.find(p => p.id === n.id).role));
    if (!guard) return null;
    for (const d of [{ x: 4, y: -1 }, { x: -4, y: -1 }, { x: 4, y: 0 }, { x: -4, y: 0 }, { x: 3, y: -3 }, { x: -3, y: -3 }]) {
        const st = clone(base), p = { x: guard.pos.x + d.x, y: guard.pos.y + d.y };
        if (!free(st, p)) continue;
        st.crew[0].pos = p;
        st.crew[0].loadout.items.push('assaultRifle');
        for (const n of st.npcs) if (n.status !== 'away' && Math.max(Math.abs(n.pos.x - p.x), Math.abs(n.pos.y - p.y)) <= 9) know(st, n);
        return { state: st, info: { at: p, guard: guard.id, guardAt: guard.pos, facing: guard.facing } };
    }
    return null;
})()`;

/** Mara in the lobby south of the guard, who faces east over the queue, the crew knowing who stands round her. */
const GUARD_FACING_QUEUE = `(() => { ${PAGE_HELPERS}
    const base = clone(sim.state), guard = base.npcs.find(n => n.status !== 'away' && /lobbyGuard/.test(w.people.find(p => p.id === n.id).role));
    if (!guard) return null;
    guard.facing = 'e';
    for (const d of [{ x: 3, y: 3 }, { x: 2, y: 3 }, { x: 4, y: 3 }, { x: 3, y: 2 }]) {
        const st = clone(base), p = { x: guard.pos.x + d.x, y: guard.pos.y + d.y };
        if (!free(st, p)) continue;
        st.crew[0].pos = p;
        for (const n of st.npcs) if (n.status !== 'away' && Math.max(Math.abs(n.pos.x - p.x), Math.abs(n.pos.y - p.y)) <= 9) know(st, n);
        return { state: st, info: { at: p, guardAt: guard.pos } };
    }
    return null;
})()`;

/** Mara selected with a Move previewed north across the guard's view (`GUARD_FACING_QUEUE`); `all` turns on every cone. */
const acrossGuard = (all: boolean) => async (page: Page, info: { at: { x: number; y: number }; guardAt: { x: number; y: number } }) => {
    if (all) {
        await page.locator('[data-region="drawer-button"]').click();
        await page.locator('[data-overlay="cones"]').click();
        await page.locator('[data-region="drawer-button"]').click();
    }
    await selectMara(page);
    await settle(page);
    const to = await page.evaluate(([at, g]: [{ x: number; y: number }, { x: number; y: number }]) => {
        const tiles = (window as any).sim.safeFloor('mara').tiles.filter((t: any) => t.band === 'move' && t.pos.y < g.y && Math.abs(t.pos.x - at.x) <= 1);
        return tiles.sort((a: any, b: any) => a.pos.y - b.pos.y)[0]?.pos;
    }, [info.at, info.guardAt] as [{ x: number; y: number }, { x: number; y: number }]);
    if (to) await tapTile(page, to);
};

/** The queue's last customer facing south, Mara a few tiles south-east of her in the lobby, every cone shown. */
const CUSTOMER_FACING_SOUTH = `(() => { ${PAGE_HELPERS}
    const base = clone(sim.state), queue = base.npcs.filter(n => n.status !== 'away' && /customer/.test(w.people.find(p => p.id === n.id).role));
    if (!queue.length) return null;
    const c = queue.sort((a, b) => b.pos.y - a.pos.y)[0];
    c.facing = 's';
    for (const d of [{ x: 3, y: 4 }, { x: 4, y: 4 }, { x: 3, y: 5 }, { x: 2, y: 4 }]) {
        const st = clone(base), p = { x: c.pos.x + d.x, y: c.pos.y + d.y };
        if (!free(st, p)) continue;
        st.crew[0].pos = p;
        for (const n of st.npcs) if (n.status !== 'away' && Math.max(Math.abs(n.pos.x - p.x), Math.abs(n.pos.y - p.y)) <= 9) know(st, n);
        return { state: st, info: { at: p, customer: c.id } };
    }
    return null;
})()`;

/** Mara selected with every cone shown and a Move previewed across (or along) the customer's cone's edge. */
const byCustomerCone = (cross: boolean) => async (page: Page, info: { customer: string }) => {
    await page.locator('[data-region="drawer-button"]').click();
    await page.locator('[data-overlay="cones"]').click();
    await page.locator('[data-region="drawer-button"]').click();
    await selectMara(page);
    await settle(page);
    const to = await page.evaluate(([id, cross]: [string, boolean]) => {
        const cone = (window as any).game.scene.getScene('bank').play.overlay.content.cones.find((k: any) => k.id === id);
        const seen = new Set([...cone.core, ...cone.peripheral].map((p: any) => `${p.x},${p.y}`)), inCone = (p: any) => seen.has(`${p.x},${p.y}`);
        const near = (p: any) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => seen.has(`${p.x + dx!},${p.y + dy!}`));
        const tiles = (window as any).sim.safeFloor('mara').tiles.filter((t: any) => t.band !== 'stay' && t.path.length >= 2);
        const score = (t: any) => cross ? (t.path.some(inCone) && !inCone(t.pos) ? t.path.filter(inCone).length * 10 + t.path.length : -1)
            : (!t.path.some(inCone) ? t.path.filter(near).length * 10 + t.path.length : -1);
        const best = tiles.sort((a: any, b: any) => score(b) - score(a))[0];
        return best && score(best) >= 0 ? best.pos : undefined;
    }, [info.customer, cross] as [string, boolean]);
    if (to) await tapTile(page, to);
};

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
        script: BESIDE_GUARD,
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
    },
    'visibility': {
        about: 'Mara beside a guard after a world phase: what she sees in colour, the street veiled, the rooms behind hidden',
        script: BESIDE_GUARD,
        then: async page => {
            await page.evaluate(() => (window as any).sim.endTurn());
            await page.waitForFunction(() => !(window as any).game.scene.getScene('bank').debugState.play?.playing);
            await selectMara(page);
            await lookAtMara(page);
        }
    },
    'jun-dash-queue': {
        about: 'Jun in the lobby beside the queue with a Dash past it previewed: its noise ring, who hears it, the Dash band',
        script: JUN_BY_QUEUE,
        then: async (page, info: { at: { x: number; y: number }; queueX: number; queueY: number }) => {
            await selectJun(page);
            await settle(page);
            // The Dash tile just past the queue's far end, level with it.
            const to = await page.evaluate(([qx, qy]: [number, number]) => {
                const tiles = (window as any).sim.safeFloor('jun').tiles.filter((t: any) => t.band === 'dash' && t.pos.x < qx);
                const d = (t: any) => Math.abs(t.pos.x - (qx - 1)) + 2 * Math.abs(t.pos.y - qy);
                return tiles.sort((a: any, b: any) => d(a) - d(b))[0]?.pos;
            }, [info.queueX, info.queueY] as [number, number]);
            if (to) await tapTile(page, to);
        }
    },
    'jun-by-queue': {
        about: 'Jun selected in the lobby beside the queue, nothing previewed: his Move and Dash bands and their safe floor',
        script: JUN_BY_QUEUE,
        then: async page => {
            await selectJun(page);
            await settle(page);
        }
    },
    'stay-pip': {
        about: 'Jun dashed past the queue last turn: the guard comes to look, so staying put gains a pip (his own tile says so)',
        script: JUN_BY_QUEUE,
        then: async (page, info: { queueX: number; queueY: number }) => {
            await page.evaluate(([qx, qy]: [number, number]) => {
                const sim = (window as any).sim, tiles = sim.safeFloor('jun').tiles.filter((t: any) => t.band === 'dash');
                const d = (t: any) => Math.abs(t.pos.x - (qx - 3)) + 2 * Math.abs(t.pos.y - qy);
                const to = tiles.sort((a: any, b: any) => d(a) - d(b))[0];
                sim.commit({ type: 'dash', crew: 'jun', path: to.path });
                sim.endTurn();
            }, [info.queueX, info.queueY] as [number, number]);
            await page.waitForFunction(() => !(window as any).game.scene.getScene('bank').debugState.play.playing);
            await selectJun(page);
            await settle(page);
        }
    },
    'stay-pip-path': {
        about: 'stay-pip with a Move previewed away from the tile',
        script: JUN_BY_QUEUE,
        then: async (page, info: { queueX: number; queueY: number }) => {
            await SETUPS['stay-pip']!.then!(page, info);
            const to = await page.evaluate(() => (window as any).sim.safeFloor('jun').tiles
                .filter((t: any) => t.band === 'move' && t.path.length === 3).sort((a: any, b: any) => b.pos.y - a.pos.y)[0]?.pos);
            if (to) await tapTile(page, to);
        }
    },
    'guard-cone-path': {
        about: 'Mara selected south of the lobby guard (facing the queue) with a Move previewed north across his view',
        script: GUARD_FACING_QUEUE,
        then: acrossGuard(false)
    },
    'guard-cone-path-all': {
        about: 'guard-cone-path with every cone shown (the Cones overlay on)',
        script: GUARD_FACING_QUEUE,
        then: acrossGuard(true)
    },
    'customer-cone-cross': {
        about: 'a customer facing south in the lobby, every cone shown, a Move by Mara previewed across the edge of her cone',
        script: CUSTOMER_FACING_SOUTH,
        then: byCustomerCone(true)
    },
    'customer-cone-skirt': {
        about: 'customer-cone-cross with the Move previewed along the cone, just outside it',
        script: CUSTOMER_FACING_SOUTH,
        then: byCustomerCone(false)
    },
    'safe-floor': {
        about: 'Mara two tiles from an NPC with the bank scouted round her, her Move band showing the most kinds of tile',
        script: SAFE_FLOOR_SETUP,
        then: async page => {
            await selectMara(page);
            await settle(page);
        }
    },
    'path-through-cone': {
        about: 'Mara armed beside the lobby guard with a Move previewed through his view to a tile out of his sight',
        script: NEAR_LOBBY_GUARD,
        then: async page => {
            await selectMara(page);
            await settle(page);
            // The end out of sight whose path crosses the most tiles in sight (red), 3 steps or more.
            const to = await page.evaluate(() => {
                const tiles = (window as any).sim.safeFloor('mara').tiles.filter((t: any) => t.band === 'move');
                const kind = new Map(tiles.map((t: any) => [`${t.pos.x},${t.pos.y}`, t.tint.kind]));
                const seen = (t: any) => t.path.slice(0, -1).filter((p: any) => /red|camera/.test(String(kind.get(`${p.x},${p.y}`)))).length;
                return tiles.filter((t: any) => t.path.length >= 3 && !/red|camera/.test(t.tint.kind)).sort((a: any, b: any) => seen(b) - seen(a))[0]?.pos;
            });
            if (to) await tapTile(page, to);
        }
    },
    'armed-by-guard': {
        about: 'Mara armed beside the lobby guard, nothing previewed: her bands, the red floor where he sees her',
        script: NEAR_LOBBY_GUARD,
        then: async page => {
            await selectMara(page);
            await settle(page);
        }
    },
    'path-to-red': {
        about: 'the safe-floor scene with a Move previewed to the red tile furthest along (a path through a cone)',
        script: SAFE_FLOOR_SETUP,
        then: async page => {
            await selectMara(page);
            await settle(page);
            const to = await page.evaluate(() => (window as any).sim.safeFloor('mara').tiles
                .filter((t: any) => t.band === 'move' && (t.tint.kind === 'red' || t.tint.kind === 'camera'))
                .sort((a: any, b: any) => b.path.length - a.path.length)[0]?.pos);
            if (to) await tapTile(page, to);
        }
    },
    'hatched-held': {
        about: 'Jun armed, the bank scouted 5 tiles round him: an unknown-risk tile held, where someone unknown could watch',
        script: HATCHED_SETUP,
        then: async page => {
            await selectJun(page);
            await settle(page);
            const tile = await page.evaluate(() => (window as any).sim.safeFloor('jun').tiles
                .filter((t: any) => t.band === 'move' && t.tint.kind === 'unknownRisk' && t.knowledge === 'unknownRisk' && t.path.length >= 3)
                .sort((a: any, b: any) => a.path.length - b.path.length)[0]?.pos);
            if (tile) await holdTile(page, tile);
        }
    }
};
