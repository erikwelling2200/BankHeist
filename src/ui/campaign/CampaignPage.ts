import { COMPLICATIONS, newCampaign, nextStep, timeline, type Campaign, type CampaignCommand } from '../../campaign';
import {
    campaignAct, dropCampaignHeist, heistUnfinished, lastCampaignError, loadCampaign, saveCampaign
} from '../../game/campaign';
import { savedHeist } from '../../game/heist';
import { MemoryStorage, webStorage, type SaveStorage } from '../../game';
import { askPlayer } from '../askPlayer';
import './campaign.css';

/*
 * The campaign's readout (`?campaign`, implementation plan M6-01): the day, the Squeeze and its whole timeline (§19.2),
 * the day's heist, and the day actions there are so far: plan a heist (the pinned bank until contracts, M6-02) and lay
 * low. Plain HTML: the city map is M6-06's.
 */

const ACTION_NAMES = { heist: 'Heist', case: 'Cased a bank', layLow: 'Laid low' } as const;
const RESULT_NAMES = { success: 'clean getaway', partial: 'partial success', failure: 'failed' } as const;

/** Shows the campaign page in place of the game, and `window.campaign` for tests and the console. */
export function showCampaign(): void {
    const storage: SaveStorage = webStorage() ?? new MemoryStorage();
    document.documentElement.classList.add('campaign-page');
    const root = document.createElement('main');
    root.className = 'cp';
    document.body.append(root);
    const go = (query: string) => location.assign(`${location.pathname}?${query}${new URLSearchParams(location.search).has('still') ? '&still' : ''}`);

    const render = (): void => {
        const campaign = loadCampaign(storage), broken = !campaign && storage.get('campaign') !== null;
        root.replaceChildren(campaign ? campaignView(campaign) : startView(broken));
    };

    const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] => {
        const e = document.createElement(tag);
        if (cls) e.className = cls;
        if (text !== undefined) e.textContent = text;
        return e;
    };
    const button = (label: string, cls: string, onClick: () => void): HTMLButtonElement => {
        const b = el('button', cls, label);
        b.addEventListener('click', onClick);
        return b;
    };

    function start(seed: number): void {
        const old = loadCampaign(storage);
        if (old) dropCampaignHeist(storage, old.seed);
        saveCampaign(storage, newCampaign(seed));
        render();
    }

    function startView(broken: boolean): HTMLElement {
        const box = el('section', 'cp-panel');
        box.append(el('h1', 'cp-title', 'Campaign'));
        if (broken) {
            box.append(el('p', 'cp-warn', "The saved campaign can't be read. Starting a new one replaces it."));
            console.warn("The saved campaign can't be read", lastCampaignError);
        }
        box.append(el('p', '', 'The Big One waits. Every day you spend getting ready tightens the Squeeze.'));
        box.append(button('Start a campaign', 'cp-go cp-start', () => start(Math.floor(Math.random() * 0x100000000))));
        return box;
    }

    async function act(cmd: CampaignCommand, campaign: Campaign): Promise<void> {
        if (heistUnfinished(campaign) && !(await askPlayer(`Day ${campaign.visit!.day}'s heist isn't over.`, 'Abandoning it counts as a failed job (+2 Squeeze).', 'Abandon it', 'Keep it'))) return;
        const done = campaignAct(storage, cmd);
        if (!('refused' in done)) dropCampaignHeist(storage, campaign.seed);
        render();
        const stopped = 'refused' in done ? done.refused : done.events.find(e => e.type === 'stopped')?.reason;
        if (stopped) root.querySelector('.cp-panel')?.append(el('p', 'cp-warn', 'refused' in done ? stopped : `The abandoned heist brought the Raid: ${stopped.toLowerCase()}.`));
    }

    function campaignView(c: Campaign): HTMLElement {
        const box = el('section', 'cp-panel');
        const head = el('div', 'cp-head');
        head.append(el('h1', 'cp-title', `Day ${c.day}`));
        const squeeze = el('div', 'cp-squeeze');
        squeeze.append(el('span', 'cp-label', 'Squeeze'), el('span', 'cp-num', String(c.squeeze)));
        head.append(squeeze);
        box.append(head);

        const next = nextStep(c);
        const phase = {
            open: next ? `Next: ${next.name} at ${next.at} (day ${next.day} if nothing else adds to it).` : '',
            raid: 'The Raid: the task force is at the safehouse door (the forced escape is not playable yet).',
            finaleDue: 'The crew got out of the Raid: the finale is today.',
            over: 'The campaign is over.'
        }[c.phase];
        box.append(el('p', `cp-phase cp-${c.phase}`, phase));

        // The whole timeline (§19.2): every complication, its threshold and the day it landed or lands.
        const list = el('ol', 'cp-timeline');
        for (const step of timeline(c)) {
            const li = el('li', `cp-step${step.landed ? ' landed' : ''}${step.complication === null ? ' raid' : ''}`);
            li.title = step.text;
            li.append(el('span', 'cp-at', String(step.at)), el('span', 'cp-name', step.name), el('span', 'cp-day', step.landed ? `landed day ${step.day}` : `day ${step.day}`));
            list.append(li);
        }
        box.append(el('h2', 'cp-sub', 'The Squeeze'), list);

        // The day's heist, and the days spent.
        if (c.visit?.kind === 'heist') {
            const v = c.visit;
            const saved = savedHeist(storage);
            const here = saved?.campaign?.seed === c.seed && saved.campaign.day === v.day;
            const p = el('p', 'cp-visit', v.result ? `Day ${v.day}'s heist: ${RESULT_NAMES[v.result]}.` : `Day ${v.day}'s heist isn't over.`);
            if (!v.result && here) p.append(' ', button('Resume it', 'cp-link cp-resume', () => go('')));
            box.append(p);
        }
        if (c.days.length) {
            const days = el('p', 'cp-days');
            days.textContent = c.days.map(d => `${d.day}: ${ACTION_NAMES[d.action]}`).join(' · ');
            box.append(days);
        }
        const landed = c.landed.slice(0, c.complications.length).map((_, i) => COMPLICATIONS[c.complications[i]!].name);
        if (landed.length) box.append(el('p', 'cp-landed', `On the finale: ${landed.join(', ')}.`));

        const row = el('div', 'cp-actions');
        if (c.phase === 'open') {
            row.append(
                button('Plan a heist', 'cp-go cp-plan', () => go('plan&campaign')),
                button('Lay low', 'cp-act cp-laylow', () => void act({ kind: 'layLow' }, c))
            );
        }
        row.append(button('New campaign', 'cp-act cp-new', () => void askPlayer('Start a new campaign?', 'This one is lost for good.', 'Start new', 'Keep it')
            .then(yes => { if (yes) start(Math.floor(Math.random() * 0x100000000)); })));
        box.append(row);
        return box;
    }

    render();
    Object.assign(window, {
        campaign: {
            get: () => loadCampaign(storage),
            act: (cmd: CampaignCommand) => {
                const done = campaignAct(storage, cmd);
                render();
                return done;
            },
            start: (seed: number) => start(seed)
        }
    });
}
