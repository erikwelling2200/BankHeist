import { COMMIT_CUES, crewWithActionsLeft, labelFit, liveCarriers, shownActions, statePill, threatIcon, threatTone, TONE_WORDS, trackPercent } from './derive';
import { h, img } from './dom';
import { iconUrl, portraitUrl } from './icons';
import {
    DEFAULT_KEYMAP, OVERLAY_IDS, type ActionVM, type CrewVM, type HudCallbacks, type HudHandle, type HudKeymap, type HudOptions, type HudViewModel,
    type OverlayId, type PortraitName, type ThreatVM
} from './viewModels';
import './hud.css';

/** How long End turn is held (§20.2: "hold to confirm"). */
export const HOLD_MS = 600;
/** How long a press lasts before it counts as a long-press and names the button (UI.md "Touch grammar"). */
const LONG_PRESS_MS = 450;
/** How far a finger may drift before a press stops counting as a long-press. */
const LONG_PRESS_SLOP = 8;

const OVERLAY_NAMES: Record<OverlayId, string> = {
    zones: 'Zones', cones: 'All vision cones', cameras: 'Cameras', cover: 'Cover', sound: 'Sound map', materials: 'Wall materials'
};
const PROFILE_NAMES = { clean: 'Clean', concealed: 'Concealed', armed: 'Armed', heavy: 'Heavy', unknown: 'Profile unknown' } as const;
const KEY_NAMES: Record<string, string> = { ' ': 'Space', enter: 'Enter', tab: 'Tab', escape: 'Esc' };

export type HudPanel = 'ledger' | 'drawer' | 'prompt' | null;

/** The handle, plus what the dev page (`?scene=hud`) uses to show a state without clicking through to it. */
export interface HudDevHandle extends HudHandle {
    showPanel(panel: HudPanel): void;
}

/**
 * Mounts the stealth HUD (UI.md "Screen layout", §20.3) into `root`: the top strip, the crew rail, the camera tools and
 * the overlay drawer for the left thumb, the action grid, Confirm, Undo and End turn for the right, the threat ledger and
 * the recap card. It draws whatever view model `update` gives it and reports every input through `callbacks`; the only
 * state it keeps is its own (which sheet is open, a hold in progress). Hotkeys follow §20.7 and `options.keymap`.
 *
 * `update` may run every frame: it patches the DOM in place, keyed by id, and leaves what didn't change alone, so a tap
 * that straddles an update still lands, focus stays put and the live regions speak only on change.
 */
export function mountHud(root: HTMLElement, callbacks: HudCallbacks, options: HudOptions = {}): HudDevHandle {
    const keys: HudKeymap = { ...DEFAULT_KEYMAP, ...options.keymap };
    const keyIs = (e: KeyboardEvent, key: string) => e.key.toLowerCase() === key.toLowerCase();
    const capName = (key: string) => KEY_NAMES[key.toLowerCase()] ?? key.toUpperCase();
    let vm: HudViewModel | undefined;
    let panel: HudPanel = null;
    let recapDismissed = false;
    const sigs = new WeakMap<Element, string>();
    /** Runs `draw` only when `sig` differs from what `target` last drew. */
    const changed = (target: Element, sig: string) => { if (sigs.get(target) === sig) return false; sigs.set(target, sig); return true; };

    const el = h('div.sh', { role: 'region', 'aria-label': 'Heist controls' });
    const fine = window.matchMedia('(hover: hover) and (pointer: fine)');
    const keycaps = () => el.classList.toggle('keys', fine.matches);
    keycaps();
    fine.addEventListener('change', keycaps);
    // Taps on the HUD never reach the map underneath (no pan starts on a button), and a pressed button doesn't take the
    // focus, so Space and Enter keep their hotkey meaning instead of pressing it again.
    el.addEventListener('pointerdown', e => { if ((e.target as HTMLElement).closest('button, .sh-sheet')) e.stopPropagation(); });
    el.addEventListener('mousedown', e => { if ((e.target as HTMLElement).closest('button')) e.preventDefault(); });
    el.addEventListener('wheel', e => { if ((e.target as HTMLElement).closest('.sh-sheet')) e.stopPropagation(); });

    // ---------------------------------------------------------------------------------------------- top strip
    const pill = h('div.sh-panel.sh-state', { 'data-region': 'state', role: 'status' });
    const timeline = h('div.sh-panel.sh-timeline', { 'data-region': 'timeline' });
    const turn = h('div.sh-panel.sh-turn', { 'data-region': 'turn' });
    const ledgerCount = h('span.sh-count', { hidden: true });
    const ledgerBtn = h('button.sh-ledger-btn', { 'data-region': 'ledger-button', 'aria-label': 'Threat ledger', 'aria-expanded': 'false', 'aria-controls': 'sh-ledger', 'data-tag': 'Threat ledger' },
        h('span.sh-panel.sh-ledger-face', {}, img(iconUrl('bell')), ledgerCount), keycap(capName(keys.ledger)));
    ledgerBtn.addEventListener('click', () => toggle('ledger'));
    const top = h('div.sh-top', {}, pill, timeline, turn, ledgerBtn);

    // ---------------------------------------------------------------------------------------------- end turn
    const fill = h('span.sh-fill');
    const endTurn = h('button.sh-panel.sh-endturn', { 'data-region': 'end-turn', 'aria-label': 'End turn (hold)', 'aria-haspopup': 'dialog', 'data-tag': 'Hold to end turn' },
        fill, img(iconUrl('end')), keycap(capName(keys.endTurn)));

    // ---------------------------------------------------------------------------------------------- left thumb
    const rail = h('div.sh-rail', { role: 'toolbar', 'aria-label': 'Crew', 'aria-orientation': 'vertical' });
    const mapBtn = h('button.sh-panel.sh-btn', { 'data-region': 'map', 'aria-label': 'Tactical map', 'aria-pressed': 'false', 'data-tag': 'Tactical map' }, img(iconUrl('map')));
    mapBtn.addEventListener('click', () => callbacks.toggleMap?.());
    const drawerBtn = h('button.sh-panel.sh-btn', { 'data-region': 'drawer-button', 'aria-label': 'Overlays', 'aria-expanded': 'false', 'aria-controls': 'sh-drawer', 'data-tag': 'Overlays' },
        img(iconUrl('layers')), keycap(capName(keys.drawer)));
    drawerBtn.addEventListener('click', () => toggle('drawer'));
    const ltools = h('div.sh-ltools', {}, mapBtn, drawerBtn);
    const drawer = h('div.sh-sheet.sh-drawer', { id: 'sh-drawer', role: 'group', 'aria-label': 'Overlays', 'data-region': 'drawer', hidden: true });
    const overlayBtns = new Map<OverlayId, HTMLButtonElement>();
    for (const id of OVERLAY_IDS) {
        const b = h('button.sh-panel.sh-btn.sh-ov', { 'aria-label': OVERLAY_NAMES[id], 'aria-pressed': 'false', 'data-tag': OVERLAY_NAMES[id], 'data-overlay': id },
            overlayPicture(id), h('span.sh-onmark'));
        b.addEventListener('click', () => vm && callbacks.toggleOverlay(id, !vm.overlays[id]));
        overlayBtns.set(id, b);
        drawer.append(b);
    }
    // The safe floor's promise, and its limit (§8.8, §8.15).
    drawer.append(h('div.sh-legend', { role: 'note' }, 'Safe floor: green, and hatched for the next world phase, counts only the NPCs the crew knows of. Grey: no data.'));

    // ---------------------------------------------------------------------------------------------- right thumb
    const actions = h('div.sh-actions', { role: 'toolbar', 'aria-label': 'Actions' });
    const undo = h('button.sh-panel.sh-btn.sh-undo', { 'data-region': 'undo', 'aria-label': 'Undo', 'data-tag': 'Undo' }, img(iconUrl('undo')), keycap(capName(keys.undo)));
    undo.addEventListener('click', () => { if (vm?.undoEnabled) callbacks.undo(); });
    const confirm = h('button.sh-confirm', { 'data-region': 'confirm' });
    confirm.addEventListener('click', () => { if (vm?.confirm.enabled) callbacks.confirm(); });
    // What Confirm would set off (§8.8): "this would start: Teller button (2)", and what it would stop.
    const confirmNote = h('div.sh-cnote', { 'data-region': 'confirm-note', role: 'status', hidden: true });

    // ---------------------------------------------------------------------------------------------- sheets
    const ledger = h('div.sh-sheet.sh-ledger', { id: 'sh-ledger', role: 'region', 'aria-label': 'Threat ledger', 'data-region': 'ledger', hidden: true });
    const ledgerRows = h('div.sh-rows');
    ledger.append(h('div.sh-sheet-title', {}, img(iconUrl('bell')), h('span', {}, 'THREATS')), ledgerRows);
    const prompt = h('div.sh-sheet.sh-prompt', { role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': 'sh-prompt-title', 'data-region': 'prompt', tabindex: '-1', hidden: true });
    const recap = h('div.sh-recap-back', { hidden: true });
    const tag = h('div.sh-tag', { 'aria-hidden': 'true', hidden: true });

    el.append(top, endTurn, rail, ltools, drawer, actions, undo, confirm, confirmNote, ledger, prompt, recap, tag);
    root.append(el);
    if (options.textScale) el.style.setProperty('--sh-text', String(options.textScale));
    el.classList.toggle('cb', !!options.colourBlind);

    // ---------------------------------------------------------------------------------------------- name tags
    // Long-press (touch) or hover (mouse) on a button names it in a tag beside it; a long-press doesn't also press it,
    // and a finger that drifts is a drag, not a long-press.
    let pressTimer = 0, longPressed = false, tagTimer = 0, pressAt = { x: 0, y: 0 };
    const showTag = (target: HTMLElement, text: string) => {
        window.clearTimeout(tagTimer);
        tag.textContent = text;
        tag.hidden = false;
        const r = target.getBoundingClientRect(), t = tag.getBoundingClientRect(), W = window.innerWidth;
        const besideLeft = target.closest('.sh-actions, .sh-undo');
        let x = besideLeft ? r.left - t.width - 8 : r.right + 8, y = r.top + r.height / 2 - t.height / 2;
        if (target.closest('.sh-drawer, .sh-ltools')) { x = r.left + r.width / 2 - t.width / 2; y = r.top - t.height - 8; }
        if (target.closest('.sh-endturn, .sh-ledger-btn')) { x = r.right - t.width; y = r.bottom + 6; }
        tag.style.left = `${Math.max(4, Math.min(W - t.width - 4, x))}px`;
        tag.style.top = `${Math.max(4, y)}px`;
    };
    const hideTag = (delay = 0) => { window.clearTimeout(tagTimer); tagTimer = window.setTimeout(() => { tag.hidden = true; }, delay); };
    const tagged = (e: Event) => (e.target as HTMLElement).closest<HTMLElement>('[data-tag]');
    el.addEventListener('pointerdown', e => {
        const t = tagged(e);
        longPressed = false;
        window.clearTimeout(pressTimer);
        if (!t || e.pointerType === 'mouse' || t === endTurn) return;
        pressAt = { x: e.clientX, y: e.clientY };
        pressTimer = window.setTimeout(() => { longPressed = true; showTag(t, t.dataset.tag!); }, LONG_PRESS_MS);
    });
    el.addEventListener('pointermove', e => {
        if (Math.hypot(e.clientX - pressAt.x, e.clientY - pressAt.y) > LONG_PRESS_SLOP) window.clearTimeout(pressTimer);
    });
    const endPress = () => { window.clearTimeout(pressTimer); if (longPressed) hideTag(900); };
    el.addEventListener('pointerup', endPress);
    el.addEventListener('pointercancel', endPress);
    el.addEventListener('click', e => { if (longPressed) { e.stopPropagation(); e.preventDefault(); longPressed = false; } }, true);
    el.addEventListener('contextmenu', e => { if (tagged(e)) e.preventDefault(); });
    el.addEventListener('pointerover', e => { const t = tagged(e); if (t && e.pointerType === 'mouse') showTag(t, t.dataset.tag!); });
    el.addEventListener('pointerout', e => { if (e.pointerType === 'mouse' && tagged(e)) hideTag(); });

    // ---------------------------------------------------------------------------------------------- end turn
    let holdStart = 0, holdFrame = 0;
    const startHold = () => {
        if (holdStart || !vm || panel === 'prompt') return;
        holdStart = performance.now();
        // Unused pips flash first (UI.md "End turn").
        el.classList.toggle('flash-pips', crewWithActionsLeft(vm.crew).length > 0);
        endTurn.classList.add('holding');
        const step = () => {
            const k = Math.min(1, (performance.now() - holdStart) / HOLD_MS);
            fill.style.width = `${k * 100}%`;
            if (k < 1) { holdFrame = requestAnimationFrame(step); return; }
            finishHold();
        };
        holdFrame = requestAnimationFrame(step);
    };
    /** The hold is complete: ask first if anyone still has actions, else end the turn. */
    const finishHold = () => {
        stopHold();
        if (vm && crewWithActionsLeft(vm.crew).length) open('prompt');
        else callbacks.endTurn();
    };
    /** Let go: a hold that lasted `HOLD_MS` counts even if no frame came to see it (slow frames), a shorter one doesn't. */
    const releaseHold = () => {
        if (holdStart && performance.now() - holdStart >= HOLD_MS) finishHold();
        else stopHold(true);
    };
    const stopHold = (early = false) => {
        if (!holdStart) return;
        cancelAnimationFrame(holdFrame);
        holdStart = 0;
        fill.style.width = '0';
        endTurn.classList.remove('holding');
        if (early) { el.classList.remove('flash-pips'); showTag(endTurn, 'Hold to end turn'); hideTag(1200); }
    };
    endTurn.addEventListener('pointerdown', e => {
        if (e.button !== 0) return;
        try { endTurn.setPointerCapture(e.pointerId); } catch { /* a synthetic pointer */ }
        startHold();
    });
    endTurn.addEventListener('pointerup', releaseHold);
    endTurn.addEventListener('pointercancel', () => stopHold(true));
    // A click without a pointer (the keyboard, assistive tech) can't hold: it always asks first, so one press never ends
    // the turn.
    endTurn.addEventListener('click', e => { if (e.detail === 0) open('prompt'); });

    // ---------------------------------------------------------------------------------------------- panels
    let returnFocus: HTMLElement | null = null;
    function open(p: HudPanel): void {
        const was = panel;
        panel = p;
        ledger.hidden = p !== 'ledger';
        drawer.hidden = p !== 'drawer';
        prompt.hidden = p !== 'prompt';
        ledgerBtn.setAttribute('aria-expanded', String(p === 'ledger'));
        ledgerBtn.classList.toggle('on', p === 'ledger');
        drawerBtn.setAttribute('aria-expanded', String(p === 'drawer'));
        drawerBtn.classList.toggle('on', p === 'drawer');
        if (p !== 'prompt') el.classList.remove('flash-pips');
        if (p === 'prompt' && was !== 'prompt') {
            renderPrompt();
            // The dialog takes the focus (so screen readers announce it) and gives it back when it closes.
            returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
            prompt.focus();
        } else if (was === 'prompt' && p !== 'prompt') {
            const back = returnFocus;
            returnFocus = null;
            if (document.activeElement === prompt || prompt.contains(document.activeElement)) back && back !== document.body ? back.focus() : prompt.blur();
        }
    }
    const toggle = (p: Exclude<HudPanel, null>) => open(panel === p ? null : p);
    const endTurnNow = () => { open(null); callbacks.endTurn(); };

    // ---------------------------------------------------------------------------------------------- hotkeys (§20.7)
    /** Focus is on the page itself (or the game canvas), not on a control that has its own use for keys. */
    const focusFree = (t: EventTarget | null) => !(t instanceof Element) || t === document.body || t === document.documentElement || t.tagName === 'CANVAS' || t === prompt || t.closest('.sh-recap') === t;
    const onKeyDown = (e: KeyboardEvent) => {
        const t = e.target as HTMLElement | null;
        if (e.ctrlKey || e.metaKey || e.altKey || t?.closest?.('input, select, textarea, [contenteditable]') || !vm) return;
        const free = focusFree(t);
        // A focused button answers Space and Enter itself; the hotkeys don't press anything a second time.
        if (!free && (keyIs(e, ' ') || keyIs(e, 'Enter'))) return;
        if (!recap.hidden) {
            if (keyIs(e, keys.confirm) || keyIs(e, keys.endTurn)) { e.preventDefault(); if (!e.repeat) resume(); }
            return;
        }
        if (panel === 'prompt') {
            if (keyIs(e, keys.endTurn) || keyIs(e, keys.confirm)) { e.preventDefault(); if (!e.repeat) endTurnNow(); return; }
            if (keyIs(e, keys.close)) { e.preventDefault(); open(null); return; }
        }
        const crewKey = keys.selectCrew.findIndex(k => keyIs(e, k));
        if (crewKey >= 0) {
            if (e.repeat) return;
            const c = vm.crew[crewKey];
            if (c) callbacks.selectCrew(c.id);
        } else if (keyIs(e, keys.endTurn)) {
            e.preventDefault();
            if (!e.repeat) startHold();
        } else if (keyIs(e, keys.confirm)) {
            e.preventDefault();
            if (!e.repeat && vm.confirm.enabled) callbacks.confirm();
        } else if (keyIs(e, keys.undo)) {
            if (!e.repeat && vm.undoEnabled) callbacks.undo();
        } else if (keyIs(e, keys.ledger)) {
            // Tab still moves the focus between controls; from the page or the map it opens the ledger.
            if (!free) return;
            e.preventDefault();
            toggle('ledger');
        } else if (keyIs(e, keys.drawer)) {
            if (!e.repeat) toggle('drawer');
        } else if (keyIs(e, keys.close)) {
            open(null);
        }
    };
    const onKeyUp = (e: KeyboardEvent) => {
        if (!keyIs(e, keys.endTurn)) return;
        if (focusFree(e.target)) e.preventDefault();
        stopHold(true);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    // ---------------------------------------------------------------------------------------------- rendering
    /**
     * Keeps `parent`'s children in step with `items` by key: an element is made once per key and kept while its key is,
     * and refilled only when its item (`sig`) changed. Buttons keep their identity (and the focus, and a press in
     * progress); their insides don't take pointer events, so a refill under a finger doesn't lose the tap.
     */
    function reconcile<T>(parent: HTMLElement, items: readonly T[], keyOf: (t: T) => string, sigOf: (t: T, i: number) => string,
        make: (key: string) => HTMLElement, fillIn: (e: HTMLElement, t: T, i: number) => void): void {
        const existing = new Map<string, HTMLElement>();
        for (const c of [...parent.children] as HTMLElement[]) existing.set(c.dataset.key ?? '', c);
        items.forEach((t, i) => {
            const key = keyOf(t);
            let e = existing.get(key);
            if (e) existing.delete(key);
            else { e = make(key); e.dataset.key = key; }
            if (changed(e, sigOf(t, i))) fillIn(e, t, i);
            if (parent.children[i] !== e) parent.insertBefore(e, parent.children[i] ?? null);
        });
        for (const e of existing.values()) e.remove();
    }

    function renderTop(v: HudViewModel): void {
        const p = statePill(v);
        if (changed(pill, JSON.stringify(p))) {
            pill.className = `sh-panel sh-state ${p.tone}`;
            pill.setAttribute('aria-label', p.label);
            pill.replaceChildren(img(iconUrl(p.icon)), h('span.sh-num', {}, p.text));
        }
        if (changed(turn, String(v.turn))) {
            turn.replaceChildren(h('span.sh-num', {}, String(v.turn)));
            turn.setAttribute('aria-label', `Turn ${v.turn}`);
        }
        const n = liveCarriers(v.ledger);
        if (changed(ledgerCount, String(n))) {
            ledgerCount.textContent = n ? String(n) : '';
            ledgerCount.hidden = !n;
            ledgerBtn.setAttribute('aria-label', n ? `Threat ledger, ${n} live` : 'Threat ledger');
        }
        if (!changed(timeline, JSON.stringify([v.bank, v.schedule, v.turn]))) return;
        const heat = v.bank.heat;
        if (heat) {
            // With the police on site the strip shows the heat and what its next level brings (§20.3).
            timeline.className = 'sh-panel sh-timeline heat';
            timeline.setAttribute('aria-label', `Heat ${heat.level}${heat.next ? `, ${heat.next.label} in ${heat.next.inTurns}` : ''}`);
            put(timeline, img(iconUrl('heat')), h('span.sh-num', {}, String(heat.level)),
                h('span.sh-heatbar', {}, ...Array.from({ length: 5 }, (_, i) => h(i < heat.ticks ? 'i.on' : 'i'))),
                heat.next ? h('span.sh-label', {}, `▸ ${heat.next.label} in ${heat.next.inTurns}`) : null);
            return;
        }
        if (v.bank.status === 'alarm') {
            // After the Alarm the schedule gives way to the police: the turns until they arrive.
            const eta = v.bank.policeEta ?? null;
            timeline.className = 'sh-panel sh-timeline police';
            timeline.setAttribute('aria-label', eta === null ? 'Police called' : eta > 0 ? `Police in ${eta}` : 'Police on site');
            const cells = eta === null ? 0 : Math.min(8, Math.max(eta, 1));
            put(timeline, img(iconUrl('police')), h('span.sh-label', {}, 'POLICE'),
                h('span.sh-eta', {}, ...Array.from({ length: cells }, (_, i) => h(eta !== null && i < eta ? 'i' : 'i.off'))),
                h('span.sh-num', {}, eta === null ? '?' : eta > 0 ? String(eta) : 'ON SITE'));
            return;
        }
        const schedule = v.schedule ?? { end: Math.max(v.turn, 2), events: [] };
        timeline.className = 'sh-panel sh-timeline';
        timeline.setAttribute('aria-label', schedule.events.length ? `Schedule: ${schedule.events.map(e => `${e.label} turn ${e.turn}`).join(', ')}` : 'Schedule');
        const now = trackPercent(schedule, v.turn);
        const track = h('div.sh-track', {}, h('div.sh-done', { style: `width: ${now}%` }));
        for (const e of [...schedule.events].sort((a, b) => a.turn - b.turn)) {
            track.append(h(e.turn < v.turn ? 'div.sh-ev.past' : 'div.sh-ev', { style: `left: ${trackPercent(schedule, e.turn)}%`, title: `${e.label}: turn ${e.turn}` },
                img(iconUrl(e.icon)), h('b', {}, String(e.turn))));
        }
        track.append(h('div.sh-now', { style: `left: ${now}%` }));
        put(timeline, track);
    }

    function portrait(name: PortraitName | undefined, fallback: string, className: string): HTMLElement {
        const url = name ? portraitUrl(name) : undefined;
        return url ? img(url, className) : h(`span.${className}.sh-initial` as 'span', {}, fallback.slice(0, 1).toUpperCase());
    }

    function hpBar(hp: CrewVM['hp']): HTMLElement {
        if (!hp) return h('span.sh-hp.unknown', { title: 'HP unknown' }, 'HP ?');
        const bar = h(hp.now < hp.max ? 'span.sh-hp.hurt' : 'span.sh-hp');
        for (let k = 0; k < hp.max; k++) bar.append(h(k < hp.now ? 'i' : 'i.off'));
        return bar;
    }

    function renderRail(v: HudViewModel): void {
        rail.classList.toggle('compact', v.crew.length > 4);
        reconcile(rail, v.crew, c => c.id, (c, i) => JSON.stringify([c, i]), key => {
            const card = h('button.sh-crew', { 'data-crew': key });
            card.addEventListener('click', () => callbacks.selectCrew(key));
            return card;
        }, (card, c, i) => {
            const pips = h('span.sh-ap');
            for (let k = 0; k < c.actionsMax; k++) pips.append(h(`i${k >= 2 ? '.go' : ''}${k >= c.actionsLeft ? '.off' : '.left'}` as 'i'));
            const status = [c.name, PROFILE_NAMES[c.profile], `${c.actionsLeft} of ${c.actionsMax} actions`, c.hp ? `HP ${c.hp.now} of ${c.hp.max}` : 'HP unknown',
                c.exposedTo.length ? `exposed to ${c.exposedTo.length}` : '', c.carrying === 'van' ? 'in the van' : c.carrying === 'loot' ? 'carrying loot' : '',
                c.ammo ? `${c.ammo.mag} rounds, ${c.ammo.spare} magazines${c.ammo.lastMag ? ', last magazine' : ''}` : ''].filter(Boolean).join(', ');
            card.className = `sh-crew${c.selected ? ' sel' : ''}${c.actionsLeft === 0 ? ' spent' : ''}`;
            card.setAttribute('style', `--c: ${c.colour}`);
            card.setAttribute('data-region', `crew-${c.id}`);
            card.setAttribute('aria-label', status);
            card.setAttribute('aria-pressed', String(c.selected));
            card.dataset.tag = c.name;
            put(card, 
                h('span.sh-side', {},
                    c.carrying ? h('span.sh-badge', {}, img(iconUrl(c.carrying === 'van' ? 'car' : 'bag'))) : null,
                    h(c.profile === 'unknown' ? 'span.sh-badge.unknown' : 'span.sh-badge', { title: PROFILE_NAMES[c.profile] }, c.profile === 'unknown' ? '?' : img(iconUrl(c.profile))),
                    c.ammo ? h(c.ammo.lastMag ? 'span.sh-ammo.last' : 'span.sh-ammo', {}, String(c.ammo.mag)) : null),
                portrait(c.portrait, c.name, 'sh-face'), pips,
                h('span.sh-foot', {}, hpBar(c.hp), c.exposedTo.length ? h('span.sh-exp', {}, img(iconUrl('eye')), String(c.exposedTo.length)) : null),
                keys.selectCrew[i] ? keycap(capName(keys.selectCrew[i]!)) : null);
        });
    }

    const actionTag = (a: ActionVM) => (a.enabled || !a.reason ? a.label : `${a.label} · ${a.reason}`);

    function renderActions(v: HudViewModel): void {
        reconcile(actions, shownActions(v.actions), a => a.id, a => JSON.stringify(a), key => {
            const b = h('button.sh-act', { 'data-action': key });
            b.addEventListener('click', () => {
                const a = vm?.actions.find(x => x.id === key);
                if (!a) return;
                if (a.enabled) callbacks.action(a.id);
                else { showTag(b, actionTag(a)); hideTag(1400); }
            });
            return b;
        }, (b, a) => {
            b.className = `sh-act${a.selected ? ' sel' : ''}${a.enabled ? '' : ' na'}${a.go ? ' go' : ''}`;
            b.setAttribute('data-region', `action-${a.id}`);
            b.setAttribute('aria-label', `${a.label}${a.progress ? ` (${a.progress})` : ''}${a.enabled ? '' : `: ${a.reason ?? 'not now'}`}`);
            b.setAttribute('aria-disabled', String(!a.enabled));
            b.setAttribute('aria-pressed', String(!!a.selected));
            b.dataset.tag = actionTag(a);
            const cost = h('span.sh-cost');
            for (let k = 0; k < a.cost; k++) cost.append(h('i'));
            b.replaceChildren(...[img(iconUrl(a.icon)), cost, a.progress ? h('span.sh-prog', {}, a.progress) : null].filter(x => x !== null));
        });
    }

    function renderConfirm(v: HudViewModel): void {
        const c = v.confirm;
        if (changed(confirm, JSON.stringify(c))) {
            const cue = COMMIT_CUES[c.kind];
            confirm.className = `sh-confirm ${c.enabled ? c.kind : 'off'} fit-${labelFit(c.label)}`;
            confirm.setAttribute('aria-label', c.enabled ? `Confirm ${c.label} (${cue.words})` : `Confirm: ${c.label ? `${c.label}, ` : ''}nothing previewed`);
            confirm.setAttribute('aria-disabled', String(!c.enabled));
            const cost = h('span.sh-cost');
            for (let k = 0; k < c.cost; k++) cost.append(h('i'));
            confirm.replaceChildren(...[c.enabled ? img(iconUrl(cue.icon), 'sh-ic sh-kind') : null, img(iconUrl(c.icon ?? 'confirm')),
                c.label ? h('span.sh-cname', {}, c.label) : null, c.cost ? cost : null].filter(x => x !== null));
        }
        const starts = c.enabled ? c.starts ?? [] : [], stops = c.enabled ? c.stops ?? [] : [];
        if (changed(confirmNote, JSON.stringify([starts, stops]))) {
            confirmNote.hidden = !starts.length && !stops.length;
            confirmNote.className = `sh-cnote${starts.length ? ' starts' : ' stops'}`;
            put(confirmNote,
                starts.length ? h('span.sh-cstart', {}, img(iconUrl('bell')), h('span', {}, `this would start: ${starts.join(', ')}`)) : null,
                stops.length ? h('span.sh-cstop', {}, h('span', {}, `stops: ${stops.join(', ')}`)) : null);
        }
        undo.setAttribute('aria-disabled', String(!v.undoEnabled));
        undo.classList.toggle('off', !v.undoEnabled);
    }

    function threatRow(row: HTMLElement, t: ThreatVM, first: boolean): void {
        const tone = threatTone(t);
        row.className = `sh-row ${tone}${first ? ' first' : ''}`;
        row.setAttribute('aria-label', `${t.label} in ${t.countdown}${TONE_WORDS[tone] ? `, ${TONE_WORDS[tone]}` : ''}`);
        row.replaceChildren(...[h('span.sh-n', {}, String(t.countdown)), t.portrait ? portrait(t.portrait, t.label, 'sh-p') : null, img(iconUrl(threatIcon(t.kind))),
            h('span.sh-rlabel', {}, t.label), t.halted ? h('span.sh-paused', { title: 'Paused' }, 'II') : null, t.pos ? img(iconUrl('eye'), 'sh-ic sh-jump') : null].filter(x => x !== null));
    }

    function renderLedger(v: HudViewModel): void {
        reconcile(ledgerRows, v.ledger, t => t.id, (t, i) => JSON.stringify([t, i === 0]), key => {
            const row = h('button.sh-row', { 'data-threat': key });
            row.addEventListener('click', () => {
                const t = vm?.ledger.find(x => x.id === key);
                if (t?.pos) callbacks.ledgerJump({ x: t.pos.x, y: t.pos.y }, t.targetId);
            });
            return row;
        }, (row, t, i) => threatRow(row, t, i === 0));
        const empty = !v.ledger.length;
        if (empty !== !!ledger.querySelector('.sh-empty')) {
            if (empty) ledger.append(h('div.sh-empty', {}, 'No live clocks'));
            else ledger.querySelector('.sh-empty')?.remove();
        }
    }

    function renderPrompt(): void {
        if (!vm) return;
        const left = crewWithActionsLeft(vm.crew);
        const keep = h('button.sh-panel.sh-pbtn', { 'aria-label': 'Keep playing' }, 'BACK');
        keep.addEventListener('click', () => open(null));
        const end = h('button.sh-pbtn.sh-pend', { 'aria-label': 'End turn now' }, img(iconUrl('end')), 'END TURN', keycap(capName(keys.endTurn)));
        end.addEventListener('click', endTurnNow);
        put(prompt, 
            h('div.sh-ptitle', { id: 'sh-prompt-title' }, left.length ? `ACTIONS LEFT: END TURN?` : 'END TURN?'),
            left.length ? h('div.sh-pcrew', {}, ...left.map(c => h('span.sh-pface', { style: `--c: ${c.colour}`, title: `${c.name}: ${c.actionsLeft} left` },
                portrait(c.portrait, c.name, 'sh-p'), h('span.sh-ap', {}, ...Array.from({ length: c.actionsLeft }, () => h('i.left')))))) : null,
            h('div.sh-prow', {}, keep, end));
    }

    function resume(): void {
        recapDismissed = true;
        recap.hidden = true;
        callbacks.resume?.();
    }

    function renderRecap(v: HudViewModel): void {
        if (!v.recap) recapDismissed = false;
        const show = !!v.recap && !recapDismissed, wasHidden = recap.hidden;
        recap.hidden = !show;
        if (!show || !v.recap || !changed(recap, JSON.stringify(v.recap))) return;
        const r = v.recap, p = statePill(r), heat = r.bank.heat;
        const heatEl = heat ? h('span.sh-heat', {}, img(iconUrl('heat')), h('span.sh-big', {}, String(heat.level)),
            h('span.sh-heatbar', {}, ...Array.from({ length: 5 }, (_, i) => h(i < heat.ticks ? 'i.on' : 'i')))) : null;
        const events = r.events.slice(-3).map(e => h('div.sh-ev-row', {}, e.portrait ? portrait(e.portrait, e.text, 'sh-p') : null, e.icon ? img(iconUrl(e.icon)) : null,
            h('span.sh-rlabel', {}, e.text), e.delta !== undefined ? h(`span.sh-num.${e.delta < 0 ? 'neg' : 'pos'}` as 'span', {}, e.delta > 0 ? `+${e.delta}` : String(e.delta)) : null,
            h('span.sh-tiny', {}, `T${e.turn}`)));
        const crew = r.crew.map(c => h(`div.sh-mini${c.status === 'done' ? '.done' : ''}` as 'div',
            { style: `--c: ${c.colour}`, title: `${c.name}: ${c.status}${c.exposed ? ', exposed' : ''}` },
            portrait(c.portrait, c.name, 'sh-face'), c.exposed ? h('span.sh-exp', {}, img(iconUrl('eye'))) : null, hpBar(c.hp)));
        const threats = r.threats.slice(0, 4).map(t => h(`span.sh-chip.${threatTone(t)}` as 'span', { title: t.label }, h('span.sh-n', {}, String(t.countdown)), img(iconUrl(threatIcon(t.kind)))));
        const go = h('button.sh-confirm.clean.sh-resume', { 'aria-label': 'Resume' }, img(iconUrl('play')), h('span.sh-cname', {}, 'RESUME'));
        go.addEventListener('click', resume);
        const card = h('div.sh-sheet.sh-recap', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Where you left off', 'data-region': 'recap', tabindex: '-1' },
            h('div.sh-rcol', {},
                h('div.sh-rhead', {}, h('span.sh-big', { 'aria-label': `Turn ${r.turn}` }, String(r.turn)),
                    h(`span.sh-state.sh-panel.${p.tone}` as 'span', { 'aria-label': p.label }, img(iconUrl(p.icon)), h('span.sh-num', {}, p.text)), h('span.sh-grow'), heatEl),
                ...events),
            h('div.sh-rcol.sh-rright', {},
                h('div.sh-minis', {}, ...crew),
                h('div.sh-threats', {}, img(iconUrl('bell')), ...(threats.length ? threats : [h('span.sh-tiny', {}, 'none')])),
                go));
        recap.replaceChildren(card);
        if (wasHidden) card.focus();
    }

    function renderOverlays(v: HudViewModel): void {
        for (const [id, b] of overlayBtns) {
            b.classList.toggle('on', !!v.overlays[id]);
            b.setAttribute('aria-pressed', String(!!v.overlays[id]));
        }
        mapBtn.classList.toggle('on', !!v.mapOn);
        mapBtn.setAttribute('aria-pressed', String(!!v.mapOn));
    }

    return {
        update(next: HudViewModel): void {
            vm = next;
            renderTop(next);
            renderRail(next);
            renderActions(next);
            renderConfirm(next);
            renderLedger(next);
            renderOverlays(next);
            renderRecap(next);
            if (panel === 'prompt' && changed(prompt, JSON.stringify(crewWithActionsLeft(next.crew)))) renderPrompt();
        },
        setTextScale(scale: number): void {
            el.style.setProperty('--sh-text', String(scale));
        },
        setColourBlind(on: boolean): void {
            el.classList.toggle('cb', on);
        },
        showPanel: open,
        destroy(): void {
            stopHold();
            window.clearTimeout(pressTimer);
            window.clearTimeout(tagTimer);
            window.removeEventListener('keydown', onKeyDown);
            window.removeEventListener('keyup', onKeyUp);
            fine.removeEventListener('change', keycaps);
            el.remove();
        }
    };
}

/** A desktop key cap printed on its button (§20.7, UI.md "Desktop"); shown only where there is a mouse. */
function keycap(key: string): HTMLElement {
    return h('kbd.sh-kc', { 'aria-hidden': 'true' }, key);
}

/** Each overlay's button is a small picture of the overlay itself (UI.md "Tactical map and overlay drawer"). */
function overlayPicture(id: OverlayId): HTMLElement {
    if (id === 'cover') return img(iconUrl('shield'));
    if (id === 'sound') return img(iconUrl('ear'));
    return h(`span.sh-ov-${id}` as 'span');
}

/** Replaces `parent`'s children, skipping the absent ones. */
function put(parent: HTMLElement, ...children: (Node | string | null | undefined)[]): void {
    parent.replaceChildren(...children.filter((c): c is Node | string => c !== null && c !== undefined));
}
