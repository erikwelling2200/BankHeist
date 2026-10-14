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
import { VaultScene } from './scenes/VaultScene';
import { Fullscreen } from './ui/Fullscreen';
import { installDebugHandle, MemoryStorage, webStorage } from './game';
import { playHeist } from './game/heist';
import type { PlaySetup } from './scenes/BankScene';

/** The bank `?play` opens without a seed in the address: a small branch (decision Q1), pinned so every run is the same. */
export const PLAY_BANK = { seed: '31-2', tier: 'small', archetype: 'twoWing' } as const;

/** Starts the game on the scene the address names (`?scene=`, default the generated bank). Loaded only off the HUD page. */
export function startGame(params: URLSearchParams, scene: string): void {
    // `?play` is the game (implementation plan §2.5): the pinned bank (or `&seed=`), played through a Session that
    // autosaves to this browser and resumes (`&new` starts afresh).
    const play = params.has('play') && !params.has('scene');
    if (play && !params.has('seed')) {
        for (const [k, v] of Object.entries(PLAY_BANK)) params.set(k, v);
        history.replaceState(null, '', `${location.pathname}?${params}`.replace(/=(?=&|$)/g, ''));
    }
    // `?scene=rooms` is the room gallery: every room type furnished in a few sizes (`?seed=` picks other parcels).
    const gallery = scene === 'rooms' ? roomGallery(Number(params.get('seed') ?? 1)) : undefined;
    const bank = gallery ? { data: gallery.data, generated: undefined } : ['props', 'officer', 'demo'].includes(scene) ? undefined : generateAddressed();
    const playSetup = play && bank?.generated ? startHeist(bank.generated, params.has('new')) : undefined;
    if (playSetup && params.has('new')) {
        // Started afresh once: reloading the page resumes this heist rather than starting yet another.
        const address = new URLSearchParams(location.search);
        address.delete('new');
        history.replaceState(null, '', `${location.pathname}?${address}`.replace(/=(?=&|$)/g, ''));
    }

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
        physics: { default: 'arcade', arcade: { debug: false } },
        input: { activePointers: 3 },
        // A generated bank opens by default (`?bank=example` for the hand-made one); `?scene=props` shows every prop in its
        // four facings, `?scene=demo` the old stack demo, `?scene=officer` the police officer's animation preview.
        // `?scene=lobby` is an older link to the bank.
        scene: [{ bank: BankScene, lobby: BankScene, rooms: BankScene, props: PropSheetScene, officer: OfficerScene, demo: VaultScene }[scene] ?? BankScene],
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
        history.pushState(null, '', `${location.pathname}?${new URLSearchParams(params)}`);
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

    /** The addressed bank, its generating timed into the browser's performance timeline (`bank: generate`) for profiling. */
    function generateAddressed(): ReturnType<typeof bankFromAddress> {
        const start = performance.now(), next = bankFromAddress();
        performance.measure('bank: generate', { start });
        return next;
    }

    if (bank?.generated && !playSetup) {
        showPanels(bank.generated);
        window.addEventListener('popstate', showAddressedBank);
    }

    Object.assign(window, { game, Phaser, gallery: gallery?.cells });

    new Fullscreen();
    registerSW({ immediate: true });
}

/**
 * The heist in a generated bank: resumed from this browser's autosave if it was played in this bank (unless `fresh`),
 * with `window.sim` for debugging and the e2e tests, and saved whenever the page is hidden or left (§20.6).
 */
function startHeist(generated: GeneratedBank, fresh: boolean): PlaySetup {
    const storage = webStorage() ?? new MemoryStorage();
    const { session, resumed } = playHeist(generated, storage, { fresh });
    installDebugHandle(session);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') session.save(); });
    window.addEventListener('pagehide', () => session.save());
    Object.assign(window, { generated });
    return { session, bank: generated, resumed };
}
