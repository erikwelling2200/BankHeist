import { IllegalCommand, registerCommand } from '../core/engine';
import { facingToward, inBounds } from '../core/grid';
import { crewMember, spendActions } from '../core/state';
import { registerEvents } from '../core/undo';

/*
 * The crew's simplest actions (§6.3). `move` is a placeholder that only checks the shape of the path: the movement
 * package's own `registerCommand('move', …)` takes its place (range, diagonals at 1.5, walls and corners, armour).
 * Wait and the other actions are in rules/actions/.
 */

registerCommand('move', (ctx, cmd) => {
    const member = crewMember(ctx.state, cmd.crew);
    const to = cmd.path.at(-1);
    if (!to) throw new IllegalCommand('A move needs a path');
    let at = member.pos;
    for (const step of cmd.path) {
        if (!inBounds(ctx.world, step)) throw new IllegalCommand(`(${step.x}, ${step.y}) is off the map`);
        if (Math.max(Math.abs(step.x - at.x), Math.abs(step.y - at.y)) !== 1) {
            throw new IllegalCommand(`(${step.x}, ${step.y}) isn't next to (${at.x}, ${at.y})`);
        }
        at = step;
    }
    spendActions(member, 1);
    const from = member.pos;
    member.facing = facingToward(cmd.path.at(-2) ?? from, to) ?? member.facing;
    member.pos = { x: to.x, y: to.y };
    ctx.emit({ type: 'moved', crew: member.id, from, to: member.pos, path: cmd.path.map(p => ({ x: p.x, y: p.y })) });
}, { placeholder: true });

registerEvents({
    moved: { undoBlocking: false },
    waited: { undoBlocking: false }
});
