import { TILE } from '../../level/level';

/**
 * Full walls stand 1.5 tiles tall. A wall block is the wall's cap (its top, seen from above, one tile deep) over its
 * south face; the block's bottom edge is the wall's base line, so the cap and the top of the face overlap the floor
 * behind the wall. Half-height objects such as the counter stay well below this, so the two read apart.
 */
export const WALL_HEIGHT = 24;
export const BLOCK_HEIGHT = TILE + WALL_HEIGHT;
/** The shop front is a thin wall: only this much of its cap, along the street edge, is drawn. */
export const THIN_CAP = 4;
