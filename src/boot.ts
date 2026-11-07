import Phaser from 'phaser';
import { registerSW } from 'virtual:pwa-register';
import { bankFromAddress } from './bankSource';
import { roomGallery } from './gen/gallery';
import type { GeneratedBank } from './gen/model';
import { Briefing } from './ui/Briefing';
import { GeneratorBar } from './ui/GeneratorBar';
import { BankScene } from './scenes/BankScene';
import { OfficerScene } from './scenes/OfficerScene';
import { PropSheetScene } from './scenes/PropSheetScene';
import { Fullscreen } from './ui/Fullscreen';
import { installDebugHandle, MemoryStorage, Session, webStorage, type SaveStorage } from './game';
import { bankAddress, playPlan, sameAddress, savedHeist, startHeist, type CampaignTag } from './game/heist';
import type { Campaign } from './campaign';
import { bankPrint, loadIntel } from './game/intel';
import { campaignAct, campaignHeistRefusal, campaignIntel, campaignKeeper, dropCampaignHeist, heistUnfinished, loadCampaign, untaggedKeeper } from './game/campaign';
import { defaultSetup, planOptions, setupFromAddress, type HeistSetup } from './game/plan';
import { Planner } from './ui/planning/Planner';
import { askPlayer } from './ui/askPlayer';
import type { BankData } from './level/bankData';
import type { PlaySetup } from './scenes/BankScene';

/**
 * The M1 bank (implementation plan M1-16, decision Q1): the small branch the game opens without a seed in the address,
 * pinned so every run is the same.
 */
export const PLAY_BANK = { seed: '31-2', tier: 'small', archetype: 'twoWing' } as const;

/** The scenes `?scene=` can name here (`hud` never loads the game); `bank` and `lobby` are older links to the viewer. */
const SCENES = ['bank', 'lobby', 'rooms', 'props', 'officer'];

/**
 * Whether the address opens the game: the default page (`/`), `?play` (the game's own address in another bank,
 * `?play&seed=…`) or `?new`, unless it names a scene, the generated-bank viewer (`?view`) or the hand-made example bank
 * (`?bank=example`). A bare `?seed=…` is an old link to the viewer (it was the default page), never a heist: it would
 * start and autosave one in a random bank that `/` then resumes.
 */
export const playsTheGame = (params: URLSearchParams): boolean =>
    !(params.has('campaign') && !params.has('play')) && !params.has('scene') && !params.has('view') && !params.has('plan') && params.get('bank') !== 'example' && (!params.has('seed') || params.has('play') || params.has('new'));

/** Replaces the address's query with `params`, a bare flag (`view`, `play`) staying bare rather than `view=`. */
function replaceQuery(params: URLSearchParams): void {
    const query = params.toString().replace(/(^|&)(view|play|new|plan)=(?=&|$)/g, '$1$2');
    history.replaceState(null, '', `${location.pathname}${query ? `?${query}` : ''}`);
}

/** Starts the game on the scene the address names (`?scene=`, default the bank). Loaded only off the HUD page. */
export function startGame(params: URLSearchParams, scene: string): void {
    // A scene that no longer exists (`?scene=demo`, the old stack demo) is dropped: the page is what it would be without it.
    if (params.has('scene') && !SCENES.includes(scene)) {
        params.delete('scene');
        replaceQuery(params);
        scene = 'bank';
    }
    // The default page is the game (implementation plan §2.5): the pinned bank (or `?play&seed=`), played through a
    // Session that autosaves to this browser and resumes (`&new` starts afresh, after asking).
    if (playsTheGame(params)) {
        void preparePlay(params).then(({ bank, setup }) => launch(params, scene, bank, setup));
        return;
    }
    // `?plan` is the planning screen (§18, M4-07) for the pinned bank, or `?plan&seed=…`; Start begins the heist as planned.
    if (params.has('plan') && !params.has('scene') && !params.has('view')) {
        plan(params);
        return;
    }
    // An old link to the viewer (`?seed=…` without `play`) opens the viewer, and says so in its address.
    if (!params.has('scene') && !params.has('view') && params.has('seed')) {
        params = new URLSearchParams([['view', ''], ...params]);
        replaceQuery(params);
    }
    // `?view` is the generated-bank viewer (`&seed=`, `tier`, `archetype`, `plot`, and the generator bar), `?bank=example`
    // the hand-made bank; `?scene=rooms` is the room gallery: every room type furnished in a few sizes (`?seed=` picks
    // other parcels).
    const gallery = scene === 'rooms' ? roomGallery(Number(params.get('seed') ?? 1)) : undefined;
    const bank = gallery ? { data: gallery.data, generated: undefined } : ['props', 'officer'].includes(scene) ? undefined : generateAddressed();
    launch(params, scene, bank, undefined, gallery);
}

/** Starts Phaser on the scene, with the bank (and play mode's heist) handed over through the registry. */
function launch(params: URLSearchParams, scene: string, bank: { data: BankData; generated?: GeneratedBank } | undefined, playSetup: PlaySetup | undefined,
    gallery?: ReturnType<typeof roomGallery>, planning = false): Phaser.Game {
    const game = new Phaser.Game({
        type: Phaser.WEBGL,
        parent: 'game',
        width: 320,
        height: 180,
        backgroundColor: '#0b0d17',
        pixelArt: true,
        // Each light costs a little per pixel, but at 320x180 even 32 lights are cheap on phones.
        render: { maxLights: 32 },
        // EXPAND keeps 180px of height and widens the view to the screen's aspect ratio, so there are no black bars on phones.
        scale: { mode: Phaser.Scale.EXPAND, autoCenter: Phaser.Scale.CENTER_BOTH },
        input: { activePointers: 3 },
        // The bank scene plays the game and shows the viewer's banks; `?scene=props` shows every prop in its four facings,
        // `?scene=officer` the police officer's animation preview. `?scene=bank` and `?scene=lobby` are older links to the viewer.
        scene: [{ bank: BankScene, lobby: BankScene, rooms: BankScene, props: PropSheetScene, officer: OfficerScene }[scene] ?? BankScene],
        // `?still` stops what moves by itself (drifting clouds, patrols, dust), so screenshots of a view match pixel for pixel.
        callbacks: { preBoot: g => g.registry.set('bankData', bank?.data).set('still', params.has('still')).set('play', playSetup).set('planning', planning) }
    });

    let panels: { briefing: Briefing; bar: GeneratorBar } | undefined;

    /** The briefing and the generator bar for a generated bank, replacing those of the bank before it. */
    function showPanels(generated: GeneratedBank | undefined): void {
        const open = panels?.briefing.open;
        panels?.briefing.destroy();
        panels?.bar.destroy();
        panels = generated && {
            briefing: new Briefing(generated, open),
            bar: new GeneratorBar(generated, { regenerate, knowledge: full => (game.scene.getScene('bank') as BankScene).showKnowledge(full) })
        };
        // Handles for Playwright tests and console debugging.
        Object.assign(window, { generated });
    }

    /**
     * Regenerates in the page: the new picks and seed go into the address (so Back returns to the bank before), and the bank
     * scene restarts on the new bank. Generating takes a moment, so the page shows it is busy first.
     */
    function regenerate(params: Record<string, string>): void {
        history.pushState(null, '', `${location.pathname}?view&${new URLSearchParams(params)}`);
        showAddressedBank();
    }

    function showAddressedBank(): void {
        document.body.classList.add('generating');
        // Two frames, so the busy state is painted before generating blocks the page.
        requestAnimationFrame(() => requestAnimationFrame(() => {
            const next = generateAddressed();
            game.registry.set('bankData', next.data);
            game.scene.getScene('bank')!.scene.restart();
            showPanels(next.generated);
            document.body.classList.remove('generating');
        }));
    }

    if (bank?.generated && !playSetup && !planning) {
        showPanels(bank.generated);
        window.addEventListener('popstate', showAddressedBank);
    }

    Object.assign(window, { game, Phaser, gallery: gallery?.cells });

    new Fullscreen();
    registerSW({ immediate: true });
    return game;
}

/**
 * The planning screen (§18, M4-07): the bank's tactical map with the planner over it. Start begins the heist as planned,
 * after asking if a heist is saved, and opens the game on it: the saved heist, resumed.
 */
function plan(params: URLSearchParams): void {
    if (!params.has('seed')) {
        const next = new URLSearchParams(location.search);
        for (const [k, v] of Object.entries(PLAY_BANK)) next.set(k, v);
        replaceQuery(next);
    }
    const bank = generateAddressed(), generated = bank.generated!;
    const options = planOptions(generated);
    // `?plan&campaign` plans the campaign's heist of the day (M6-01): with what its crew knows of the bank today, never
    // the sandbox's intel; back to the campaign when there is none or no heist can be planned today.
    const storage = webStorage() ?? new MemoryStorage();
    const campaign = params.has('campaign') ? loadCampaign(storage) : undefined;
    if (campaign !== undefined && campaignHeistRefusal(campaign, options.world)) {
        location.replace(campaignAddress());
        return;
    }
    const game = launch(params, 'bank', bank, undefined, undefined, true);
    const map = () => {
        const scene = game.scene.getScene('bank') as BankScene | null;
        return scene?.sys.isActive() ? scene : undefined;
    };
    // Start opens the game with the plan in its address (`&setup=`): it starts the heist there, asking first if one is
    // saved, so the plan survives the page change even with no storage, and never carries `new` along.
    // What the crew knows of this bank from earlier heists in it (M5-03): the plan starts with it.
    const intel = campaign ? campaignIntel(campaign, options.world) : loadIntel(storage, options.world);
    const planner = new Planner(generated, options, defaultSetup(options, intel), map, setup => {
        const keep = [...new URLSearchParams(location.search)].filter(([k]) => !['plan', 'new', 'play', 'seed', 'tier', 'archetype', 'plot', 'setup'].includes(k));
        const query = new URLSearchParams([['play', ''], ...Object.entries(bankAddress(generated)), ['setup', JSON.stringify(setup)], ...keep]);
        location.assign(`${location.pathname}?${query.toString().replace(/(^|&)(play|campaign)=(?=&|$)/g, '$1$2')}`);
    });
    Object.assign(window, { planner, generated });
}

/** The addressed bank, its generating timed into the browser's performance timeline (`bank: generate`) for profiling. */
function generateAddressed(): ReturnType<typeof bankFromAddress> {
    const start = performance.now(), next = bankFromAddress();
    performance.measure('bank: generate', { start });
    return next;
}

/**
 * Writes the game's address once its heist is settled: without a seed when the bank is the saved heist's (a reload
 * resumes it) or the pinned one, else `?play&seed=…` with the bank's picks, so it reads as the game's, not the viewer's.
 * Never `new`, so a reload doesn't ask again.
 */
function writePlayAddress(bank: GeneratedBank, saved: ReturnType<typeof savedHeist>): void {
    const here = bankAddress(bank);
    const pinned = here.seed === PLAY_BANK.seed && here.tier === PLAY_BANK.tier && here.archetype === PLAY_BANK.archetype;
    const params = new URLSearchParams(location.search);
    for (const k of ['play', 'new', 'seed', 'tier', 'archetype', 'plot', 'setup', 'campaign']) params.delete(k);
    const rest = [...params];
    replaceQuery(new URLSearchParams(pinned || sameAddress(saved?.address, here) ? rest : [['play', ''], ...Object.entries(here), ...rest]));
}

/**
 * The heist the game opens (§20.6), never overwriting a saved one without the player's consent: without a seed in the
 * address the saved heist resumes in its own bank; with another bank's seed, or `&new`, a dialog asks first, and
 * declining goes back to the saved heist. A save that can't be read is only replaced after asking too; declining
 * that plays without saving, so the save stays as it was. Sets up `window.sim` and saving when the page is hidden.
 */
async function preparePlay(params: URLSearchParams): Promise<{ bank: ReturnType<typeof bankFromAddress>; setup: PlaySetup }> {
    const storage = webStorage() ?? new MemoryStorage();
    const saved = savedHeist(storage), seeded = params.has('seed'), fresh = params.has('new');
    if (!seeded) {
        // The saved heist's bank, or the pinned one.
        const address: Record<string, string> = !fresh && saved?.address ? { ...saved.address } : { ...PLAY_BANK };
        const next = new URLSearchParams(location.search);
        for (const k of ['seed', 'tier', 'archetype', 'plot']) next.delete(k);
        for (const [k, v] of Object.entries(address)) next.set(k, v);
        next.delete('play');
        replaceQuery(new URLSearchParams([['play', ''], ...next]));
    }
    const bank = generateAddressed();
    const generated = bank.generated!;
    const started = performance.now();
    let plan = playPlan(saved, { seeded, fresh }, bankAddress(generated));
    let session: Session | null = null;
    let target = storage;
    // A heist planned on the planning screen (`&setup=`, M4-07): started here, asking first if one is saved; a plan
    // that can't be read or played goes back to planning.
    // `&campaign` with a plan: the campaign's heist of the day (M6-01), planned with what its crew knows today; it
    // spends the day as it starts. No campaign, or no heist today: back to the campaign.
    const campaign = params.has('setup') && params.has('campaign') ? loadCampaign(storage) : undefined;
    if (campaign !== undefined && campaignHeistRefusal(campaign, planOptions(generated).world)) {
        location.replace(campaignAddress());
        return new Promise<never>(() => undefined);
    }
    const planned = params.has('setup') ? plannedSetup(params.get('setup')!, generated, storage, campaign ?? undefined) : undefined;
    let tag: CampaignTag | undefined;
    if (params.has('setup')) {
        const back = () => {
            location.replace(planAddress(generated));
            return new Promise<never>(() => undefined);
        };
        if (!planned) return back();
        const abandons = campaign && heistUnfinished(campaign) ? `Day ${campaign.visit!.day}'s heist is abandoned: a failed job (+2 Squeeze).` : '';
        if (saved) {
            const name = saved.name ? `in ${saved.name}` : 'in another bank';
            if (!(await askPlayer(`A heist ${name} is saved on this device.`, `Starting the planned one overwrites it.${abandons ? ` ${abandons}` : ''}`, 'Start new', 'Keep planning'))) return back();
        } else if (abandons && !(await askPlayer(`Day ${campaign!.visit!.day}'s heist isn't over.`, abandons, 'Start new', 'Keep planning'))) return back();
        if (campaign) {
            // The day is spent, and saved, before the heist starts: leaving it after a turn has still cost the day.
            const done = campaignAct(storage, { kind: 'heist', bank: bankPrint(planOptions(generated).world) });
            // Refused, or stopped: the heist it abandoned landed the Raid (decision 446). The campaign shows it.
            if ('refused' in done || done.events.some(e => e.type === 'stopped')) {
                // Stopped, the heist it abandoned is over: it isn't played on from `/`.
                if (!('refused' in done)) dropCampaignHeist(storage, done.campaign.seed);
                location.replace(campaignAddress());
                return new Promise<never>(() => undefined);
            }
            tag = { seed: done.campaign.seed, day: done.campaign.visit!.day };
        }
        plan = 'new';
    }
    if (plan === 'ask') {
        const name = saved?.name ? `in ${saved.name}` : 'in another bank';
        if (!(await askPlayer(`A heist ${name} is saved on this device.`, 'Starting this one overwrites it.', 'Start new', 'Resume saved'))) {
            location.replace(location.pathname);
            return new Promise(() => undefined);
        }
        plan = 'new';
    }
    if (plan === 'resume') {
        // A campaign's heist sends what it learns to its campaign day, as when it started.
        session = Session.resume(storage, { keepIntel: saved?.campaign ? campaignKeeper(storage, saved.campaign) : untaggedKeeper(storage) });
        if (!session) {
            console.warn("The saved heist can't be resumed", Session.lastResumeError);
            if (!(await askPlayer("The saved heist can't be read.", 'Start a new one in its place?', 'Start new', 'Play without saving'))) target = new MemoryStorage();
        }
    }
    const resumed = !!session;
    try {
        session ??= startHeist(generated, target, tag ? { keepIntel: campaignKeeper(target, tag) } : {}, planned, tag);
    } catch (e) {
        // A campaign heist that can't be saved with its tag (a full quota) doesn't start: back to the campaign.
        console.warn("The campaign's heist couldn't be saved", e);
        location.replace(campaignAddress());
        return new Promise<never>(() => undefined);
    }
    // A campaign heist's New heist goes back to the campaign.
    const next = (tag ?? (resumed ? saved?.campaign : undefined)) ? campaignAddress() : undefined;
    writePlayAddress(generated, savedHeist(target));
    const setupMs = performance.measure('bank: heist', { start: started }).duration;
    installDebugHandle(session);
    const s = session;
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') s.save(); });
    window.addEventListener('pagehide', () => s.save());
    Object.assign(window, { generated });
    return { bank, setup: { session, bank: generated, resumed, setupMs, ...(next ? { next } : {}) } };
}

/**
 * The plan in the address, if it reads as a setup this bank can play, knowing only the intel kept for the bank on this
 * device: the address is never a source of intel (decision 405).
 */
function plannedSetup(text: string, bank: GeneratedBank, storage: SaveStorage, campaign?: Campaign): HeistSetup | undefined {
    const options = planOptions(bank);
    return setupFromAddress(text, options, campaign ? campaignIntel(campaign, options.world) : loadIntel(storage, options.world));
}

/** The planning screen's address for a bank, keeping `still` (and `campaign`, planning the campaign's heist). */
function planAddress(bank: GeneratedBank): string {
    const here = new URLSearchParams(location.search);
    const still = here.has('still') ? '&still' : '', campaign = here.has('campaign') ? '&campaign' : '';
    return `${location.pathname}?plan&${new URLSearchParams({ ...bankAddress(bank) })}${campaign}${still}`;
}

/** The campaign's readout's address (M6-01), keeping `still`. */
function campaignAddress(): string {
    return `${location.pathname}?campaign${new URLSearchParams(location.search).has('still') ? '&still' : ''}`;
}
