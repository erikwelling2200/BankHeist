# Bank Heist

A top-down pixel-art stealth game with real-time lighting, built with Phaser 4 and TypeScript.

**Play:** https://erikwelling2200.github.io/BankHeist/

Sneak through the bank, grab every gold bar, and get back to the green exit without walking into a guard's flashlight.

## Controls
- **Phone:** touch and drag anywhere to move (floating joystick). Play in landscape.
- **Desktop:** WASD or arrow keys.

## Fullscreen
- **Installed to the home screen** (below): always fullscreen, no browser bars.
- **In a browser tab:** Android goes fullscreen on your first touch; the ⛶ button top-left toggles it. iPhone Safari
  doesn't allow web pages to go fullscreen, so on iPhone install it to the home screen.

## Install for offline play
1. Open the link once while online (this caches the whole game).
2. Add it to your home screen:
   - **iPhone (Safari):** Share button → **Add to Home Screen**.
   - **Android (Chrome):** ⋮ menu → **Add to Home screen** / **Install app**.
3. Launch it from the new icon. It runs fullscreen and works in airplane mode.

New versions are picked up automatically the next time it opens with a connection (close and reopen it once more to
see them).

## Development
```bash
npm install
npm run dev        # local dev server with hot reload
npm test           # unit tests
npm run test:e2e   # browser tests against the production build, writes screenshots/
npm run build      # production build in dist/
```
