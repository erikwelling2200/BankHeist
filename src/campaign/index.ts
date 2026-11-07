/*
 * The campaign (GAME_DESIGN §19, implementation plan M6): pure and deterministic, no Phaser, no clock and no
 * `Math.random`. The game layer (src/game/campaign.ts) saves it and wires it to planning and play.
 */
export * from './campaign';
export * from './complications';
export * from './money';
export * from './squeeze';
