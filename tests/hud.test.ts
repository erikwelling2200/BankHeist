import { describe, expect, it } from 'vitest';
import { crewWithActionsLeft, isAlarming, labelFit, liveCarriers, shownActions, statePill, threatIcon, threatTone, trackPercent } from '../src/ui/hud/derive';
import { MAX_ACTIONS, type ActionVM, type CrewVM, type ThreatVM } from '../src/ui/hud/viewModels';

const threat = (id: string, countdown: number, kind: ThreatVM['kind'], halted: ThreatVM['halted'] = null): ThreatVM =>
    ({ id, kind, source: id, label: id, countdown, halted, pos: { x: 0, y: 0 } });

describe('the stealth HUD view', () => {
    it('counts running carriers, a missed check-in among them, and gives each threat a tone and an icon', () => {
        const ledger = [threat('radio', 2, 'guardRadio'), threat('call', 2, 'missedCheckIn'), threat('phone', 2, 'phoneCall', 'paused'), threat('lunch', 11, 'schedule'), threat('swat', 3, 'reinforcement')];
        expect(liveCarriers(ledger)).toBe(2);
        expect(ledger.map(isAlarming)).toEqual([true, true, true, false, true]);
        expect(ledger.map(threatTone)).toEqual(['red', 'red', 'paused', 'neutral', 'red']);
        expect(ledger.map(t => threatIcon(t.kind))).toEqual(['radio', 'radio', 'phone', 'fork', 'police']);
    });

    it('shows the Session\'s label in the state pill, the bell and countdown while a carrier runs, and GO in gold', () => {
        expect(statePill({ bank: { status: 'quiet', label: 'QUIET', nextAlarmIn: null } })).toMatchObject({ tone: 'quiet', text: 'QUIET' });
        expect(statePill({ bank: { status: 'quiet', label: 'QUIET: alarm in 2', nextAlarmIn: 2 } })).toMatchObject({ tone: 'clock', icon: 'bell', text: '2', label: 'QUIET: alarm in 2' });
        expect(statePill({ bank: { status: 'alarm', label: 'ALARM', nextAlarmIn: null, policeEta: 4 } })).toMatchObject({ tone: 'alarm', text: 'ALARM' });
        expect(statePill({ bank: { status: 'loud', label: 'LOUD', nextAlarmIn: null } })).toMatchObject({ tone: 'loud', text: 'LOUD' });
        expect(statePill({ bank: { status: 'quiet', label: 'QUIET', nextAlarmIn: null, go: true } })).toMatchObject({ tone: 'go', text: 'GO' });
    });

    it('places turns on the schedule track from turn 1 to closing', () => {
        expect(trackPercent({ end: 45 }, 1)).toBe(0);
        expect(trackPercent({ end: 45 }, 45)).toBe(100);
        expect(trackPercent({ end: 45 }, 23)).toBe(50);
        expect(trackPercent({ end: 45 }, 60)).toBe(100);
    });

    it('asks before ending the turn only for crew who can still act, unknown HP included', () => {
        const crew = (id: string, actionsLeft: number, hp: CrewVM['hp'] = { now: 8, max: 8 }): CrewVM =>
            ({ id, name: id, colour: '#fff', actionsLeft, actionsMax: 2, profile: 'unknown', exposedTo: [], hp, selected: false });
        expect(crewWithActionsLeft([crew('a', 0), crew('b', 1), crew('c', 2, { now: 0, max: 8 }), crew('d', 1, null)]).map(c => c.id)).toEqual(['b', 'd']);
    });

    it('caps the action grid and keeps the selected action in it', () => {
        const actions: ActionVM[] = Array.from({ length: 11 }, (_, i) => ({ id: `a${i}`, label: `A${i}`, icon: 'move', cost: 1, enabled: true, selected: i === 10 }));
        const shown = shownActions(actions);
        expect(shown).toHaveLength(MAX_ACTIONS);
        expect(shown.at(-1)!.id).toBe('a10');
    });

    it('shrinks a long Confirm label and wraps the longest instead of cutting it', () => {
        expect(['Move', 'Kill panel', 'Shout: get down hard'].map(labelFit)).toEqual(['normal', 'small', 'wrap']);
    });
});
