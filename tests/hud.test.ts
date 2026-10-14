import { describe, expect, it } from 'vitest';
import { crewWithActionsLeft, liveCarriers, sortLedger, statePill, threatTone, trackPercent } from '../src/ui/hud/derive';
import type { ThreatVM } from '../src/ui/hud/viewModels';

const threat = (id: string, countdown: number, kind: ThreatVM['kind']): ThreatVM => ({ id, label: id, countdown, kind, icon: 'bell', targetId: id });

describe('the stealth HUD view', () => {
    it('sorts the ledger by urgency, alarm carriers first on a tie', () => {
        const ledger = [threat('lunch', 11, 'schedule'), threat('call', 2, 'checkIn'), threat('radio', 2, 'carrier'), threat('run', 3, 'escape')];
        expect(sortLedger(ledger).map(t => t.id)).toEqual(['radio', 'call', 'run', 'lunch']);
        expect(liveCarriers(ledger)).toBe(2);
        expect(ledger.map(threatTone)).toEqual(['neutral', 'neutral', 'red', 'red']);
    });

    it('shows QUIET, then the most urgent carrier, then ALARM and LOUD in the state pill', () => {
        const quiet = { status: 'quiet' as const, policeEta: null };
        expect(statePill({ bank: quiet, ledger: [threat('call', 5, 'checkIn')] })).toMatchObject({ tone: 'quiet', text: 'QUIET' });
        expect(statePill({ bank: quiet, ledger: [threat('run', 3, 'escape'), threat('bell', 2, 'carrier')] })).toMatchObject({ tone: 'alarm', text: '2', label: 'bell in 2' });
        expect(statePill({ bank: { status: 'alarm', policeEta: 4 }, ledger: [] })).toMatchObject({ tone: 'alarm', text: 'ALARM', label: 'Alarm: police in 4' });
        expect(statePill({ bank: { status: 'loud', policeEta: null }, ledger: [] })).toMatchObject({ tone: 'loud', text: 'LOUD' });
    });

    it('places turns on the schedule track from turn 1 to closing', () => {
        expect(trackPercent({ end: 45 }, 1)).toBe(0);
        expect(trackPercent({ end: 45 }, 45)).toBe(100);
        expect(trackPercent({ end: 45 }, 23)).toBe(50);
        expect(trackPercent({ end: 45 }, 60)).toBe(100);
    });

    it('asks before ending the turn only for crew who can still act', () => {
        const crew = (id: string, actionsLeft: number, hp = 8) => ({ id, name: id, colour: '#fff', actionsLeft, actionsMax: 2, profile: 'clean' as const, exposedTo: [], hp, hpMax: 8, selected: false });
        expect(crewWithActionsLeft([crew('a', 0), crew('b', 1), crew('c', 2, 0)]).map(c => c.id)).toEqual(['b']);
    });
});
