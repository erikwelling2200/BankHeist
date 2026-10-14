import './style.css';

const params = new URLSearchParams(location.search), scene = params.get('scene') ?? 'bank';

// `?scene=hud` is the stealth HUD on its own, over a blank page with sample view models (src/ui/hud/preview.ts); it
// doesn't load the game (or Phaser) at all.
if (scene === 'hud') void import('./ui/hud/preview').then(m => m.showHudPreview());
else {
    // Until the game has loaded, `window.game` would name the `#game` element; tests and the console wait for the game.
    Object.assign(window, { game: undefined });
    void import('./boot').then(m => m.startGame(params, scene));
}
