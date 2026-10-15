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
import { installDebugHandle, MemoryStorage, Session, webStorage } from './game';
import { bankAddress, playPlan, savedHeist, startHeist } from './game/heist';
import type { BankData } from './level/bankData';
import type { PlaySetup } from './scenes/BankScene';

/**
 * The M1 bank (implementation plan M1-16, decision Q1): the small branch the game opens without a seed in the address,
 * pinned so every run is the same.
 */
export const PLAY_BANK = { seed: '31-2', tier: 'small', archetype: 'twoWing' } as const;

/**
 * Whether the address opens the game: the default page (`/`, `?play` being an older link to it), unless it names a
 * scene, the generated-bank viewer (`?view`) or the hand-made example bank (`?bank=example`).
 */
export const playsTheGame = (params: URLSearchParams): boolean => !params.has('scene') && !params.has('view') && params.get('bank') !== 'example';

/** Starts the game on the scene the address names (`?scene=`, default the bank). Loaded only off the HUD page. */
export function startGame(params: URLSearchParams, scene: string): void {
    // The default page is the game (implementation plan §2.5): the pinned bank (or `&seed=`), played through a Session
    // that autosaves to this browser and resumes (`&new` starts afresh, after asking).
    if (playsTheGame(params)) {
        void preparePlay(params).then(({ bank, setup }) => launch(params, scene, bank, setup));
        return;
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
    gallery?: ReturnType<typeof roomGallery>): void {
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
        callbacks: { preBoot: g => g.registry.set('bankData', bank?.data).set('still', params.has('still')).set('play', playSetup) }
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

    if (bank?.generated && !playSetup) {
        showPanels(bank.generated);
        window.addEventListener('popstate', showAddressedBank);
    }

    Object.assign(window, { game, Phaser, gallery: gallery?.cells });

    new Fullscreen();
    registerSW({ immediate: true });
}

/** The addressed bank, its generating timed into the browser's performance timeline (`bank: generate`) for profiling. */
function generateAddressed(): ReturnType<typeof bankFromAddress> {
    const start = performance.now(), next = bankFromAddress();
    performance.measure('bank: generate', { start });
    return next;
}

/** Writes the game's address: the bank's picks (no `play`, no `new`), so a reload resumes this heist in this bank. */
function writePlayAddress(): void {
    const params = new URLSearchParams(location.search);
    params.delete('play');
    params.delete('new');
    const rest = params.toString();
    history.replaceState(null, '', `${location.pathname}${rest ? `?${rest}` : ''}`);
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
        history.replaceState(null, '', `${location.pathname}?${next}`);
    }
    const bank = generateAddressed();
    writePlayAddress();
    const generated = bank.generated!;
    const started = performance.now();
    let plan = playPlan(saved, { seeded, fresh }, bankAddress(generated));
    let session: Session | null = null;
    let target = storage;
    if (plan === 'ask') {
        const name = saved?.name ? `in ${saved.name}` : 'in another bank';
        if (!(await askPlayer(`A heist ${name} is saved on this device.`, 'Starting this one overwrites it.', 'Start new', 'Resume saved'))) {
            location.replace(location.pathname);
            return new Promise(() => undefined);
        }
        plan = 'new';
    }
    if (plan === 'resume') {
        session = Session.resume(storage);
        if (!session) {
            console.warn("The saved heist can't be resumed", Session.lastResumeError);
            if (!(await askPlayer("The saved heist can't be read.", 'Start a new one in its place?', 'Start new', 'Play without saving'))) target = new MemoryStorage();
        }
    }
    const resumed = !!session;
    session ??= startHeist(generated, target);
    const setupMs = performance.measure('bank: heist', { start: started }).duration;
    installDebugHandle(session);
    const s = session;
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') s.save(); });
    window.addEventListener('pagehide', () => s.save());
    Object.assign(window, { generated });
    return { bank, setup: { session, bank: generated, resumed, setupMs } };
}

/** A small dialog in the HUD's style; resolves true for `yes`. */
function askPlayer(title: string, text: string, yes: string, no: string): Promise<boolean> {
    return new Promise(resolve => {
        const back = document.createElement('div');
        back.className = 'play-dialog-back';
        const box = document.createElement('div');
        box.className = 'play-dialog';
        box.setAttribute('role', 'alertdialog');
        box.setAttribute('aria-modal', 'true');
        const h = document.createElement('p');
        h.className = 'play-dialog-title';
        h.textContent = title;
        const p = document.createElement('p');
        p.textContent = text;
        const row = document.createElement('div');
        row.className = 'play-dialog-buttons';
        const button = (label: string, answer: boolean, cls: string) => {
            const b = document.createElement('button');
            b.className = cls;
            b.textContent = label;
            b.addEventListener('click', () => { back.remove(); resolve(answer); });
            row.append(b);
            return b;
        };
        const keep = button(no, false, 'play-dialog-keep');
        button(yes, true, 'play-dialog-new');
        box.append(h, p, row);
        back.append(box);
        document.body.append(back);
        keep.focus();
    });
}
