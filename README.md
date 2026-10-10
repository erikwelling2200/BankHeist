# Bank Heist

A top-down pixel-art stealth game with real-time lighting, built with Phaser 4 and TypeScript.

**Play:** https://erikwelling2200.github.io/BankHeist/

Sneak through the bank, grab every gold bar, and get back to the green exit without walking into a guard's flashlight.

## Controls
- **Phone:** touch and drag anywhere to move (floating joystick). Play in landscape.
- **Desktop:** WASD or arrow keys.

## Install for offline play
Open the link on your phone, then use **Add to Home Screen** (Safari share menu, or Chrome's ⋮ menu). The game then
launches full screen and works without a connection. New versions are picked up automatically the next time it opens
online.

## Development
```bash
npm install
npm run dev        # local dev server with hot reload
npm test           # unit tests
npm run test:e2e   # browser tests against the production build, writes screenshots/
npm run build      # production build in dist/
```
