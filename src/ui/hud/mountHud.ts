import { crewWithActionsLeft, liveCarriers, sortLedger, statePill, threatTone, trackPercent } from './derive';
import { h, img } from './dom';
import { iconUrl, portraitUrl } from './icons';
import { OVERLAY_IDS, type HudCallbacks, type HudHandle, type HudIcon, type HudViewModel, type OverlayId, type PortraitName } from './viewModels';
import './hud.css';

/** How long End turn is held (§20.2: "hold to confirm"). */
export const HOLD_MS = 600;
/** How long a press lasts before it counts as a long-press and names the button (UI.md "Touch grammar"). */
const LONG_PRESS_MS = 450;

const OVERLAY_NAMES: Record<OverlayId, string> = {
    zones: 'Zones', cones: 'All vision cones', cameras: 'Cameras', cover: 'Cover', sound: 'Sound map', materials: 'Wall materials'
};
const PROFILE_NAMES = { clean: 'Clean', concealed: 'Concealed', armed: 'Armed', heavy: 'Heavy' } as const;

export type HudPanel = 'ledger' | 'drawer' | 'prompt' | null;

/** The handle, plus what the dev page (`?scene=hud`) uses to show a state without clicking through to it. */
export interface HudDevHandle extends HudHandle {
    showPanel(panel: HudPanel): void;
}

/**
 * Mounts the stealth HUD (UI.md "Screen layout", §20.3) into `root`: the top strip, the crew rail, the camera tools and
 * the overlay drawer for the left thumb, the action grid, Confirm, Undo and End turn for the right, the threat ledger and
 * the recap card. It draws whatever view model `update` gives it and reports every input through `callbacks`; the only
 * state it keeps is its own (which sheet is open, a hold in progress). Hotkeys follow §20.7.
 */
export function mountHud(root: HTMLElement, callbacks: HudCallbacks): HudDevHandle {
    let vm: HudViewModel | undefined;
    let panel: HudPanel = null;
    let recapDismissed = false;

    const el = h('div.sh', { role: 'region', 'aria-label': 'Heist controls' });
    const fine = window.matchMedia('(hover: hover) and (pointer: fine)');
    const keycaps = () => el.classList.toggle('keys', fine.matches);
    keycaps();
    fine.addEventListener('change', keycaps);
    // Taps on the HUD never reach the map underneath (no pan starts on a button).
    el.addEventListener('pointerdown', e => { if ((e.target as HTMLElement).closest('button, .sh-sheet')) e.stopPropagation(); });
    el.addEventListener('wheel', e => { if ((e.target as HTMLElement).closest('.sh-sheet')) e.stopPropagation(); });

    // ---------------------------------------------------------------------------------------------- top strip
    const pill = h('div.sh-panel.sh-state', { 'data-region': 'state', role: 'status' });
    const timeline = h('div.sh-panel.sh-timeline', { 'data-region': 'timeline' });
    const turn = h('div.sh-panel.sh-turn', { 'data-region': 'turn' });
    const ledgerCount = h('span.sh-count');
    const ledgerBtn = h('button.sh-ledger-btn', { 'data-region': 'ledger-button', 'aria-label': 'Threat ledger', 'aria-expanded': 'false', 'data-tag': 'Threat ledger' },
        h('span.sh-panel.sh-ledger-face', {}, img(iconUrl('bell')), ledgerCount), keycap('Tab'));
    ledgerBtn.addEventListener('click', () => toggle('ledger'));
    const top = h('div.sh-top', {}, pill, timeline, turn, ledgerBtn);

    // ---------------------------------------------------------------------------------------------- end turn
    const fill = h('span.sh-fill');
    const endTurn = h('button.sh-panel.sh-endturn', { 'data-region': 'end-turn', 'aria-label': 'End turn (hold)', 'data-tag': 'Hold to end turn' },
        fill, img(iconUrl('end')), keycap('Space'));

    // ---------------------------------------------------------------------------------------------- left thumb
    const rail = h('div.sh-rail', { role: 'toolbar', 'aria-label': 'Crew', 'aria-orientation': 'vertical' });
    const mapBtn = h('button.sh-panel.sh-btn', { 'data-region': 'map', 'aria-label': 'Tactical map', 'aria-pressed': 'false', 'data-tag': 'Tactical map' }, img(iconUrl('map')));
    mapBtn.addEventListener('click', () => callbacks.toggleMap?.());
    const drawerBtn = h('button.sh-panel.sh-btn', { 'data-region': 'drawer-button', 'aria-label': 'Overlays', 'aria-expanded': 'false', 'data-tag': 'Overlays' },
        img(iconUrl('layers')), keycap('O'));
    drawerBtn.addEventListener('click', () => toggle('drawer'));
    const ltools = h('div.sh-ltools', {}, mapBtn, drawerBtn);
    const drawer = h('div.sh-sheet.sh-drawer', { role: 'group', 'aria-label': 'Overlays', 'data-region': 'drawer', hidden: true });
    const overlayBtns = new Map<OverlayId, HTMLButtonElement>();
    for (const id of OVERLAY_IDS) {
        const b = h('button.sh-panel.sh-btn', { 'aria-label': OVERLAY_NAMES[id], 'aria-pressed': 'false', 'data-tag': OVERLAY_NAMES[id], 'data-overlay': id }, overlayPicture(id));
        b.addEventListener('click', () => vm && callbacks.toggleOverlay(id, !vm.overlays[id]));
        overlayBtns.set(id, b);
        drawer.append(b);
    }

    // ---------------------------------------------------------------------------------------------- right thumb
    const actions = h('div.sh-actions', { role: 'toolbar', 'aria-label': 'Actions' });
    const undo = h('button.sh-panel.sh-btn.sh-undo', { 'data-region': 'undo', 'aria-label': 'Undo', 'data-tag': 'Undo' }, img(iconUrl('undo')), keycap('Z'));
    undo.addEventListener('click', () => { if (vm?.undoEnabled) callbacks.undo(); });
    const confirm = h('button.sh-confirm', { 'data-region': 'confirm' });
    confirm.addEventListener('click', () => { if (vm?.confirm.enabled) callbacks.confirm(); });

    // ---------------------------------------------------------------------------------------------- sheets
    const ledger = h('div.sh-sheet.sh-ledger', { role: 'dialog', 'aria-label': 'Threat ledger', 'data-region': 'ledger', hidden: true });
    const prompt = h('div.sh-sheet.sh-prompt', { role: 'alertdialog', 'aria-label': 'Crew still have actions', 'data-region': 'prompt', hidden: true });
    const recap = h('div.sh-recap-back', { hidden: true });
    const tag = h('div.sh-tag', { 'aria-hidden': 'true', hidden: true });

    el.append(top, endTurn, rail, ltools, drawer, actions, undo, confirm, ledger, prompt, recap, tag);
    root.append(el);

    // ---------------------------------------------------------------------------------------------- name tags
    // Long-press (touch) or hover (mouse) on a button names it in a tag beside it; a long-press doesn't also press it.
    let pressTimer = 0, longPressed = false, tagTimer = 0;
    const showTag = (target: HTMLElement, text: string) => {
        window.clearTimeout(tagTimer);
        tag.textContent = text;
        tag.hidden = false;
        const r = target.getBoundingClientRect(), t = tag.getBoundingClientRect(), W = window.innerWidth;
        const besideLeft = target.closest('.sh-actions, .sh-endturn, .sh-ledger-btn, .sh-undo');
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
        pressTimer = window.setTimeout(() => { longPressed = true; showTag(t, t.dataset.tag!); }, LONG_PRESS_MS);
    });
    const endPress = () => { window.clearTimeout(pressTimer); if (longPressed) hideTag(900); };
    el.addEventListener('pointerup', endPress);
    el.addEventListener('pointercancel', endPress);
    el.addEventListener('click', e => { if (longPressed) { e.stopPropagation(); e.preventDefault(); longPressed = false; } }, true);
    el.addEventListener('contextmenu', e => { if (tagged(e)) e.preventDefault(); });
    el.addEventListener('pointerover', e => { const t = tagged(e); if (t && e.pointerType === 'mouse') showTag(t, t.dataset.tag!); });
    el.addEventListener('pointerout', e => { if (e.pointerType === 'mouse' && tagged(e)) hideTag(); });

    // ---------------------------------------------------------------------------------------------- end turn hold
    let holdStart = 0, holdFrame = 0;
    const startHold = () => {
        if (holdStart || !vm) return;
        holdStart = performance.now();
        // Unused pips flash first (UI.md "End turn").
        el.classList.toggle('flash-pips', crewWithActionsLeft(vm.crew).length > 0);
        endTurn.classList.add('holding');
        const step = () => {
            const k = Math.min(1, (performance.now() - holdStart) / HOLD_MS);
            fill.style.width = `${k * 100}%`;
            if (k < 1) { holdFrame = requestAnimationFrame(step); return; }
            stopHold();
            if (vm && crewWithActionsLeft(vm.crew).length) open('prompt');
            else callbacks.endTurn();
        };
        holdFrame = requestAnimationFrame(step);
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
    endTurn.addEventListener('pointerup', () => stopHold(true));
    endTurn.addEventListener('pointercancel', () => stopHold(true));
    // Keyboard users (Enter on the focused button) get the prompt's second step instead of a hold.
    endTurn.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); requestEndTurn(); } });
    const requestEndTurn = () => { if (!vm) return; if (crewWithActionsLeft(vm.crew).length) open('prompt'); else callbacks.endTurn(); };

    // ---------------------------------------------------------------------------------------------- panels
    function open(p: HudPanel): void {
        panel = p;
        ledger.hidden = p !== 'ledger';
        drawer.hidden = p !== 'drawer';
        prompt.hidden = p !== 'prompt';
        ledgerBtn.setAttribute('aria-expanded', String(p === 'ledger'));
        ledgerBtn.classList.toggle('on', p === 'ledger');
        drawerBtn.setAttribute('aria-expanded', String(p === 'drawer'));
        drawerBtn.classList.toggle('on', p === 'drawer');
        if (p !== 'prompt') el.classList.remove('flash-pips');
        if (p === 'prompt') renderPrompt();
    }
    const toggle = (p: Exclude<HudPanel, null>) => open(panel === p ? null : p);

    // ---------------------------------------------------------------------------------------------- hotkeys (§20.7)
    const onKeyDown = (e: KeyboardEvent) => {
        const t = e.target as HTMLElement | null;
        if (e.ctrlKey || e.metaKey || e.altKey || t?.closest('input, select, textarea, [contenteditable]') || !vm) return;
        if (!recap.hidden) {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); resume(); }
            return;
        }
        const k = e.key.toLowerCase();
        if (/^[1-5]$/.test(k)) {
            const c = vm.crew[Number(k) - 1];
            if (c) callbacks.selectCrew(c.id);
        } else if (k === ' ') {
            e.preventDefault();
            if (e.repeat) return;
            if (panel === 'prompt') { open(null); callbacks.endTurn(); } else startHold();
        } else if (k === 'enter') {
            if (t?.closest('button')) return;
            if (panel === 'prompt') { open(null); callbacks.endTurn(); } else if (vm.confirm.enabled) callbacks.confirm();
        } else if (k === 'z') {
            if (vm.undoEnabled) callbacks.undo();
        } else if (k === 'tab') {
            e.preventDefault();
            toggle('ledger');
        } else if (k === 'o') {
            toggle('drawer');
        } else if (k === 'escape') {
            open(null);
        } else return;
    };
    const onKeyUp = (e: KeyboardEvent) => { if (e.key === ' ') stopHold(true); };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    // ---------------------------------------------------------------------------------------------- rendering
    function renderTop(v: HudViewModel): void {
        const p = statePill(v);
        pill.className = `sh-panel sh-state ${p.tone}`;
        pill.setAttribute('aria-label', p.label);
        pill.replaceChildren(img(iconUrl(p.icon)), h('span.sh-num', {}, p.text));
        turn.replaceChildren(h('span.sh-num', {}, String(v.turn)));
        turn.setAttribute('aria-label', `Turn ${v.turn}`);
        const n = liveCarriers(v.ledger);
        ledgerCount.textContent = n ? String(n) : '';
        ledgerCount.hidden = !n;
        ledgerBtn.setAttribute('aria-label', n ? `Threat ledger, ${n} live` : 'Threat ledger');

        if (v.bank.status === 'alarm') {
            // After the Alarm the schedule gives way to the police: the turns until they arrive.
            const eta = v.bank.policeEta ?? 0, cells = Math.max(eta, 6);
            timeline.className = 'sh-panel sh-timeline police';
            timeline.setAttribute('aria-label', eta > 0 ? `Police in ${eta}` : 'Police on site');
            timeline.replaceChildren(img(iconUrl('police')), h('span.sh-label', {}, 'POLICE'),
                h('span.sh-eta', {}, ...Array.from({ length: cells }, (_, i) => h(i < eta ? 'i' : 'i.off'))), h('span.sh-num', {}, eta > 0 ? String(eta) : 'ON SITE'));
            return;
        }
        timeline.className = 'sh-panel sh-timeline';
        timeline.setAttribute('aria-label', `Schedule: ${v.schedule.events.map(e => `${e.label} turn ${e.turn}`).join(', ')}`);
        const now = trackPercent(v.schedule, v.turn);
        const track = h('div.sh-track', {}, h('div.sh-done', { style: `width: ${now}%` }));
        for (const e of [...v.schedule.events].sort((a, b) => a.turn - b.turn)) {
            track.append(h(e.turn < v.turn ? 'div.sh-ev.past' : 'div.sh-ev', { style: `left: ${trackPercent(v.schedule, e.turn)}%`, title: `${e.label}: turn ${e.turn}` },
                img(iconUrl(e.icon)), h('b', {}, String(e.turn))));
        }
        track.append(h('div.sh-now', { style: `left: ${now}%` }));
        timeline.replaceChildren(track);
    }

    function portrait(name: PortraitName | undefined, fallback: string, className: string): HTMLElement {
        const url = name ? portraitUrl(name) : undefined;
        return url ? img(url, className) : h(`span.${className}.sh-initial` as 'span', {}, fallback.slice(0, 1).toUpperCase());
    }

    function renderRail(v: HudViewModel): void {
        rail.classList.toggle('compact', v.crew.length > 4);
        rail.replaceChildren(...v.crew.map((c, i) => {
            const pips = h('span.sh-ap');
            for (let k = 0; k < c.actionsMax; k++) pips.append(h(`i${k >= 2 ? '.go' : ''}${k >= c.actionsLeft ? '.off' : '.left'}` as 'i'));
            const hp = h(c.hp < c.hpMax ? 'span.sh-hp.hurt' : 'span.sh-hp');
            for (let k = 0; k < c.hpMax; k++) hp.append(h(k < c.hp ? 'i' : 'i.off'));
            const status = [c.name, PROFILE_NAMES[c.profile], `${c.actionsLeft} of ${c.actionsMax} actions`, `HP ${c.hp} of ${c.hpMax}`,
                c.exposedTo.length ? `exposed to ${c.exposedTo.length}` : '', c.carrying === 'van' ? 'in the van' : c.carrying === 'loot' ? 'carrying loot' : ''].filter(Boolean).join(', ');
            const card = h(`button.sh-crew${c.selected ? '.sel' : ''}${c.actionsLeft === 0 ? '.spent' : ''}` as 'button',
                { style: `--c: ${c.colour}`, 'data-region': `crew-${c.id}`, 'data-crew': c.id, 'aria-label': status, 'aria-pressed': String(c.selected), 'data-tag': c.name },
                portrait(c.portrait ?? c.name.toLowerCase(), c.name, 'sh-face'), pips,
                h('span.sh-prof', { title: PROFILE_NAMES[c.profile] }, img(iconUrl(c.profile))),
                c.carrying ? h('span.sh-carry', {}, img(iconUrl(c.carrying === 'van' ? 'car' : 'bag'))) : null,
                c.exposedTo.length ? h('span.sh-exp', {}, img(iconUrl('eye')), String(c.exposedTo.length)) : null,
                hp, i < 5 ? keycap(String(i + 1)) : null);
            card.addEventListener('click', () => callbacks.selectCrew(c.id));
            return card;
        }));
    }

    function renderActions(v: HudViewModel): void {
        const buttons = v.actions.map(a => {
            const cost = h('span.sh-cost');
            for (let k = 0; k < a.cost; k++) cost.append(h('i'));
            const b = h(`button.sh-act${a.selected ? '.sel' : ''}${a.enabled ? '' : '.na'}${a.go ? '.go' : ''}` as 'button', {
                'data-region': `action-${a.id}`, 'data-action': a.id, 'aria-label': a.enabled ? a.label : `${a.label}: ${a.reason ?? 'not now'}`,
                'aria-disabled': String(!a.enabled), 'aria-pressed': String(!!a.selected), 'data-tag': a.enabled || !a.reason ? a.label : `${a.label} · ${a.reason}`
            }, img(iconUrl(a.icon)), cost);
            b.addEventListener('click', () => {
                if (a.enabled) callbacks.action(a.id);
                else { showTag(b, b.dataset.tag!); hideTag(1400); }
            });
            return b;
        });
        const rows: HTMLElement[] = [];
        for (let i = 0; i < buttons.length; i += 2) rows.push(h('div.sh-actrow', {}, ...buttons.slice(i, i + 2)));
        actions.replaceChildren(...rows);
    }

    function renderConfirm(v: HudViewModel): void {
        const c = v.confirm;
        confirm.className = `sh-confirm ${c.enabled ? c.kind : 'off'}`;
        confirm.setAttribute('aria-label', c.enabled ? `Confirm ${c.label}` : `Confirm: ${c.label || 'nothing previewed'}`);
        confirm.setAttribute('aria-disabled', String(!c.enabled));
        const cost = h('span.sh-cost');
        for (let k = 0; k < c.cost; k++) cost.append(h('i'));
        confirm.replaceChildren(...[img(iconUrl(c.icon ?? 'confirm')), c.label ? h('span.sh-cname', {}, c.label) : null, c.cost ? cost : null, keycap('Enter')].filter(x => x !== null));
        undo.setAttribute('aria-disabled', String(!v.undoEnabled));
        undo.classList.toggle('off', !v.undoEnabled);
    }

    function renderLedger(v: HudViewModel): void {
        const rows = sortLedger(v.ledger).map((t, i) => {
            const row = h(`button.sh-row.${threatTone(t)}${i === 0 ? '.first' : ''}` as 'button', { 'aria-label': `${t.label} in ${t.countdown}`, 'data-target': t.targetId },
                h('span.sh-n', {}, String(t.countdown)), t.portrait ? portrait(t.portrait, t.label, 'sh-p') : null, img(iconUrl(t.icon)),
                h('span.sh-rlabel', {}, t.label), img(iconUrl('eye'), 'sh-ic sh-jump'));
            row.addEventListener('click', () => callbacks.ledgerJump(t.targetId));
            return row;
        });
        ledger.replaceChildren(h('div.sh-sheet-title', {}, img(iconUrl('bell')), h('span', {}, 'THREATS')),
            ...(rows.length ? rows : [h('div.sh-empty', {}, 'No live clocks')]));
    }

    function renderPrompt(): void {
        if (!vm) return;
        const left = crewWithActionsLeft(vm.crew);
        const keep = h('button.sh-panel.sh-pbtn', { 'aria-label': 'Keep playing' }, 'BACK');
        keep.addEventListener('click', () => open(null));
        const end = h('button.sh-pbtn.sh-pend', { 'aria-label': 'End turn anyway' }, img(iconUrl('end')), 'END TURN', keycap('Space'));
        end.addEventListener('click', () => { open(null); callbacks.endTurn(); });
        prompt.replaceChildren(
            h('div.sh-ptitle', {}, 'ACTIONS LEFT'),
            h('div.sh-pcrew', {}, ...left.map(c => h('span.sh-pface', { style: `--c: ${c.colour}`, title: c.name },
                portrait(c.portrait ?? c.name.toLowerCase(), c.name, 'sh-p'), h('span.sh-ap', {}, ...Array.from({ length: c.actionsLeft }, () => h('i.left')))))),
            h('div.sh-prow', {}, keep, end));
    }

    function resume(): void {
        recapDismissed = true;
        recap.hidden = true;
        callbacks.resume?.();
    }

    function renderRecap(v: HudViewModel): void {
        if (!v.recap) recapDismissed = false;
        recap.hidden = !v.recap || recapDismissed;
        if (recap.hidden || !v.recap) return;
        const r = v.recap, p = statePill(v);
        const heat = r.heat === undefined ? null : h('span.sh-heat', {}, img(iconUrl('heat')), h('span.sh-big', {}, String(r.heat)),
            h('span.sh-heatbar', {}, ...Array.from({ length: 5 }, (_, i) => h(i < r.heat! ? 'i.on' : 'i'))));
        const events = r.events.slice(-3).map(e => h('div.sh-ev-row', {}, e.portrait ? portrait(e.portrait, e.label, 'sh-p') : null, img(iconUrl(e.icon)),
            h('span.sh-rlabel', {}, e.label), e.delta !== undefined ? h(`span.sh-num.${e.delta < 0 ? 'neg' : 'pos'}` as 'span', {}, e.delta > 0 ? `+${e.delta}` : String(e.delta)) : null,
            h('span.sh-tiny', {}, `T${e.turn}`)));
        const crew = v.crew.map(c => {
            const hp = h(c.hp < c.hpMax ? 'span.sh-hp.hurt' : 'span.sh-hp');
            for (let k = 0; k < c.hpMax; k++) hp.append(h(k < c.hp ? 'i' : 'i.off'));
            return h('div.sh-mini', { style: `--c: ${c.colour}`, title: c.name }, portrait(c.portrait ?? c.name.toLowerCase(), c.name, 'sh-face'), hp);
        });
        const threats = sortLedger(v.ledger).slice(0, 4).map(t => h(`span.sh-chip.${threatTone(t)}` as 'span', { title: t.label }, h('span.sh-n', {}, String(t.countdown)), img(iconUrl(t.icon))));
        const go = h('button.sh-confirm.clean.sh-resume', { 'aria-label': 'Resume' }, img(iconUrl('play')), h('span.sh-cname', {}, 'RESUME'), keycap('Enter'));
        go.addEventListener('click', resume);
        recap.replaceChildren(h('div.sh-sheet.sh-recap', { role: 'dialog', 'aria-label': 'Where you left off', 'data-region': 'recap' },
            h('div.sh-rcol', {},
                h('div.sh-rhead', {}, h('span.sh-big', { 'aria-label': `Turn ${v.turn}` }, String(v.turn)), h(`span.sh-state.sh-panel.${p.tone}` as 'span', { 'aria-label': p.label }, img(iconUrl(p.icon)), h('span.sh-num', {}, p.text)), h('span.sh-grow'), heat),
                ...events),
            h('div.sh-rcol.sh-rright', {},
                h('div.sh-minis', {}, ...crew),
                h('div.sh-threats', {}, img(iconUrl('bell')), ...(threats.length ? threats : [h('span.sh-tiny', {}, 'none')])),
                go)));
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
            if (panel === 'prompt') {
                if (crewWithActionsLeft(next.crew).length) renderPrompt();
                else open(null);
            }
        },
        setTextScale(scale: number): void {
            el.style.setProperty('--sh-text', String(scale));
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
    const icons: Partial<Record<OverlayId, HudIcon>> = { cameras: 'eye', cover: 'shield', sound: 'ear' };
    const icon = icons[id];
    return icon ? img(iconUrl(icon)) : h(`span.sh-ov-${id}` as 'span');
}

