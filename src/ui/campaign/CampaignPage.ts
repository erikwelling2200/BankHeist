import {
    campaignRefusal, COMPLICATIONS, CREW_BY_STAKES, drawRecruits, fenceCut, fenced, FRONT_COST, LAWYER_COST, launderPerDay, MARKET, motiveText, newCampaign, nextStep,
    notorietyBand, timeline, type Campaign, type CampaignCommand, type Contract, type CrewMember, type Motive
} from '../../campaign';
import { SIDE_OBJECTIVES } from '../../gen/objectives';
import { escalatedEta, TIER_SPECS } from '../../gen/tiers';
import { ITEM_NAMES, TRAIT_NAMES } from '../names';
import {
    campaignAct, dropCampaignHeist, heistUnfinished, lastCampaignError, loadCampaign, saveCampaign
} from '../../game/campaign';
import { savedHeist } from '../../game/heist';
import { MemoryStorage, webStorage, type SaveStorage } from '../../game';
import { askPlayer } from '../askPlayer';
import './campaign.css';

/*
 * The campaign's readout (`?campaign`, implementation plan M6-01): the day, the Squeeze and its whole timeline (§19.2),
 * the day's heist, and the day actions there are so far: plan one of the contracts on offer (M6-02) and lay low.
 * Plain HTML: the city map is M6-06's.
 *
 * Money and gear (§19.4, M6-03): clean and dirty money, what is laundered a day, the fence, fronts, contacts, the
 * armoury and the black market.
 *
 * The roster (§19.6, §19.7, M6-04): each crew member's traits, share, Notoriety, motive and where they are (ready,
 * injured, in jail, dead), the traits on offer to them, a lawyer and a debt to pay; and today's recruits to hire.
 */

const dollars = (n: number): string => `$${n.toLocaleString('en-US')}`;

const ACTION_NAMES = { heist: 'Heist', case: 'Cased a bank', layLow: 'Laid low' } as const;
const RESULT_NAMES = { success: 'clean getaway', partial: 'partial success', failure: 'failed' } as const;
const STAKES_NAMES = { low: 'Low stakes', medium: 'Medium stakes', high: 'High stakes' } as const;
const ARCHETYPE_NAMES: Record<string, string> = { twoWing: 'two wings', atrium: 'atrium', threeKeys: 'three keys', fortress: 'fortress', mezzanineWatch: 'mezzanine watch' };

/** A contract in a line: the chain's branch, its tier and layout. */
const TIER_NAMES: Record<string, string> = { small: 'small branch', city: 'city branch', hq: 'regional HQ' };
const contractName = (k: Contract): string => `${k.chain} ${TIER_NAMES[k.bank.tier] ?? k.bank.tier} (${ARCHETYPE_NAMES[k.bank.archetype] ?? k.bank.archetype})`;

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
            const paid = v.payout !== undefined ? ` ${dollars(v.payout)} dirty after the crew's shares.` : '';
            const where = v.contract ? ` at the ${contractName(v.contract)}` : '';
            const p = el('p', 'cp-visit', v.result ? `Day ${v.day}'s heist${where}: ${RESULT_NAMES[v.result]}.${paid}` : `Day ${v.day}'s heist${where} isn't over.`);
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
        if (c.advantages.length) box.append(el('p', 'cp-advantages', `For the finale: ${c.advantages.map(k => SIDE_OBJECTIVES[k].name).join(', ')}.`));

        box.append(el('h2', 'cp-sub', 'Contracts'), offersView(c));

        box.append(...rosterView(c));

        box.append(...moneyView(c));

        const row = el('div', 'cp-actions');
        if (c.phase === 'open') {
            row.append(button('Lay low', 'cp-act cp-laylow', () => void act({ kind: 'layLow' }, c)));
        }
        row.append(button('New campaign', 'cp-act cp-new', () => void askPlayer('Start a new campaign?', 'This one is lost for good.', 'Start new', 'Keep it')
            .then(yes => { if (yes) start(Math.floor(Math.random() * 0x100000000)); })));
        box.append(row);
        return box;
    }

    /**
     * The contracts on offer today (§19.3, §19.5): each one's stakes, bank, bonus, the security its chain added, the side
     * objective it also holds and its last day, and Plan, which plans exactly that contract's heist.
     */
    function offersView(c: Campaign): HTMLElement {
        const list = el('ul', 'cp-offers');
        if (!c.contracts.length) list.append(el('li', 'cp-note', 'No contracts on offer.'));
        for (const k of c.contracts) {
            const li = el('li', `cp-offer cp-${k.stakes}`);
            li.dataset.contract = k.id;
            li.dataset.stakes = k.stakes;
            const terms = el('div', 'cp-terms');
            terms.append(el('span', 'cp-stakes', STAKES_NAMES[k.stakes]), el('span', 'cp-name', contractName(k)));
            const [fewest, most] = CREW_BY_STAKES[k.stakes];
            const lines = [`Crew of ${fewest}–${most}. Bonus ${dollars(k.bonus)} on a clean getaway.`];
            if (k.escalation) {
                const base = TIER_SPECS[k.bank.tier].policeEta;
                lines.push(`The chain is on guard (${k.escalation} step${k.escalation === 1 ? '' : 's'}): police ETA ${escalatedEta(base, k.escalation)}, not ${base}.`);
            }
            if (k.objective) lines.push(`Also holds: ${SIDE_OBJECTIVES[k.objective].name}.`);
            lines.push(k.expires === c.day ? 'Last day.' : `Until day ${k.expires}.`);
            terms.append(el('span', 'cp-note', lines.join(' ')));
            li.append(terms);
            const plan = button('Plan', 'cp-go cp-plan', () => go(`plan&campaign&contract=${encodeURIComponent(k.id)}`));
            plan.disabled = !!campaignRefusal(c, { kind: 'heist', bank: 'any', contract: k.id });
            li.append(plan);
            list.append(li);
        }
        return list;
    }

    /** Does a command that spends no day (the fence, a front, the market, the roster) and shows the campaign again. */
    function trade(cmd: CampaignCommand, where = '.cp-money'): void {
        const done = campaignAct(storage, cmd);
        render();
        if ('refused' in done) root.querySelector(where)?.append(el('p', 'cp-warn', done.refused));
    }

    /** A motive and how it stands. */
    const motiveLine = (m: Motive): string => `${motiveText(m)}${m.met ? ': met' : m.kind === 'neverKill' ? (m.broken ? ': broken' : ' (settled at the finale)') : ''}.`;

    /** Where a crew member is. */
    function statusLine(c: Campaign, m: CrewMember): string {
        switch (m.status) {
            case 'ready': return 'Ready';
            case 'injured': return `Injured: out ${m.injured} more day${m.injured === 1 ? '' : 's'}`;
            case 'dead': return `Killed on day ${m.died}`;
            case 'jailed': {
                const j = m.jail!;
                return `In jail since day ${j.day}${j.out !== undefined ? `: a lawyer gets them out on day ${j.out}` : ''}${j.talked ? '. They talked' : ''}`
                    + (j.out === undefined && !j.talked && c.phase !== 'over' ? '. They may talk' : '');
            }
        }
    }

    /**
     * The roster (§19.6, §19.7): each crew member, the traits on offer to them, a lawyer for the jailed and a debt to
     * pay; then today's recruits, each with their trait, motive, share and signing fee.
     */
    function rosterView(c: Campaign): HTMLElement[] {
        const list = el('ul', 'cp-roster');
        for (const m of c.roster) {
            const li = el('li', `cp-member cp-${m.status}`);
            li.dataset.crew = m.id;
            const who = el('div', 'cp-terms');
            const band = notorietyBand(m.notoriety);
            who.append(el('span', 'cp-name', `${m.name} · ${m.traits.map(t => TRAIT_NAMES[t] ?? t).join(', ')}`),
                el('span', 'cp-note', `${statusLine(c, m)}. Share ${m.share}%. Notoriety ${m.notoriety} (${band}). Jobs survived: ${m.jobs}.`
                    + (m.motive ? ` Motive: ${motiveLine(m.motive)}` : '')));
            li.append(who);
            const acts = el('div', 'cp-crew-acts');
            const offer = m.traitOffers[0];
            if (offer && m.status !== 'dead') {
                acts.append(el('span', 'cp-label', 'Pick a trait'));
                for (const t of offer) {
                    const b = button(TRAIT_NAMES[t] ?? t, 'cp-link cp-trait', () => trade({ kind: 'pickTrait', crew: m.id, trait: t }, '.cp-roster'));
                    b.dataset.trait = t;
                    b.disabled = !!campaignRefusal(c, { kind: 'pickTrait', crew: m.id, trait: t });
                    acts.append(b);
                }
            }
            if (m.status === 'jailed' && m.jail!.out === undefined) {
                const b = button(`Lawyer (${dollars(LAWYER_COST)})`, 'cp-link cp-lawyer', () => trade({ kind: 'lawyer', crew: m.id }, '.cp-roster'));
                b.disabled = !!campaignRefusal(c, { kind: 'lawyer', crew: m.id });
                acts.append(b);
            }
            if (m.motive?.kind === 'debt' && !m.motive.met && m.status !== 'dead') {
                const b = button(`Pay the debt (${dollars(m.motive.amount)})`, 'cp-link cp-debt', () => trade({ kind: 'payDebt', crew: m.id }, '.cp-roster'));
                b.disabled = !!campaignRefusal(c, { kind: 'payDebt', crew: m.id });
                acts.append(b);
            }
            if (acts.childElementCount) li.append(acts);
            list.append(li);
        }
        const recruits = el('ul', 'cp-recruits');
        for (const r of drawRecruits(c.seed, c.day)) {
            const li = el('li', 'cp-recruit');
            li.dataset.recruit = r.id;
            const who = el('div', 'cp-terms');
            const hiredAlready = c.roster.some(m => m.id === r.id);
            who.append(el('span', 'cp-name', `${r.name} · ${TRAIT_NAMES[r.trait] ?? r.trait}`),
                el('span', 'cp-note', `Share ${r.share}%. Motive: ${motiveText(r.motive)}.${hiredAlready ? ' Hired.' : ''}`));
            const refused = campaignRefusal(c, { kind: 'recruit', id: r.id });
            const b = button(`Hire (${dollars(r.fee)})`, 'cp-act cp-hire', () => trade({ kind: 'recruit', id: r.id }, '.cp-recruits'));
            b.disabled = !!refused;
            if (refused) b.title = refused;
            li.append(who, b);
            recruits.append(li);
        }
        return [el('h2', 'cp-sub', 'Crew'), list, el('h2', 'cp-sub', 'Recruits today'), recruits];
    }

    /** Money (§19.4): clean and dirty, the laundering, the fence and fronts; the armoury and the black market. */
    function moneyView(c: Campaign): HTMLElement[] {
        const money = el('div', 'cp-money');
        const sums = el('div', 'cp-sums');
        const sum = (label: string, value: string, cls: string) => {
            const d = el('div', `cp-sum ${cls}`);
            d.append(el('span', 'cp-label', label), el('span', 'cp-amount', value));
            return d;
        };
        sums.append(sum('Clean', dollars(c.money.clean), 'cp-clean'), sum('Dirty', dollars(c.money.dirty), 'cp-dirty'));
        money.append(sums);
        money.append(el('p', 'cp-note', `Laundered ${dollars(launderPerDay(c))} a day (the safehouse${c.fronts ? ` and ${c.fronts} front${c.fronts === 1 ? '' : 's'}` : ''}). `
            + `Contacts: ${c.contacts}. The fence takes ${fenceCut(c)}%.`));
        const row = el('div', 'cp-actions');
        const fence = button(c.money.dirty ? `Fence ${dollars(c.money.dirty)} for ${dollars(fenced(c.money.dirty, fenceCut(c)))}` : 'Fence', 'cp-act cp-fence',
            () => trade({ kind: 'fence', amount: c.money.dirty }));
        fence.disabled = !!campaignRefusal(c, { kind: 'fence', amount: c.money.dirty });
        const front = button(`Buy a front (${dollars(FRONT_COST)})`, 'cp-act cp-front', () => trade({ kind: 'buyFront' }));
        front.disabled = !!campaignRefusal(c, { kind: 'buyFront' });
        row.append(fence, front);
        money.append(row);

        // The armoury and the black market in one list: what the crew has of each item, and its price.
        const market = el('ul', 'cp-market');
        const ids = [...new Set([...Object.keys(c.armoury), ...Object.keys(MARKET)])];
        for (const id of ids) {
            const offer = MARKET[id as keyof typeof MARKET], have = c.armoury[id] ?? 0;
            const li = el('li', 'cp-item');
            li.dataset.item = id;
            li.append(el('span', 'cp-name', ITEM_NAMES[id] ?? id), el('span', 'cp-have', `×${have}`));
            if (offer) {
                const refused = campaignRefusal(c, { kind: 'buy', item: id });
                const b = button(dollars(offer.price), 'cp-link cp-buy', () => trade({ kind: 'buy', item: id }));
                b.disabled = !!refused;
                b.title = refused === 'Needs a contact' ? 'Needs a contact' : `Buy one for ${dollars(offer.price)}`;
                b.setAttribute('aria-label', `Buy ${ITEM_NAMES[id] ?? id} for ${dollars(offer.price)}${refused ? ` (${refused.toLowerCase()})` : ''}`);
                li.append(b);
            } else li.append(el('span', 'cp-day', 'not on sale'));
            market.append(li);
        }
        return [el('h2', 'cp-sub', 'Money'), money, el('h2', 'cp-sub', 'Armoury and black market'), market];
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
