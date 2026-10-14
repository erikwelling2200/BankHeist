import { registerAction } from './act';

/*
 * Wait (§6.3): the crew member is done for this turn and spends the actions they have left. Standing there is ending
 * an action in view (§8.5), so the NPCs who see them judge them once more; with no actions left it changes nothing.
 */

registerAction('wait', {
    whyNot: () => undefined,
    candidates: (_world, _state, member) => (member.actionsLeft > 0 ? [{ type: 'wait', crew: member.id }] : []),
    cost: (_world, state, cmd) => state.crew.find(c => c.id === cmd.crew)!.actionsLeft,
    run(ctx, member) {
        ctx.emit({ type: 'waited', crew: member.id });
    }
});
