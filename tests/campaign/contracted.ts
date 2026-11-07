import { commitCampaign, type Campaign, type CampaignCommand, type Job } from '../../src/campaign';

/*
 * Tests of the campaign's other parts take whatever contract is on offer (M6-02): a heist command written without one
 * gets the first offer at its job's stakes (or the first offer), as the planning screen would hand it.
 */

export type TestCommand = CampaignCommand | { kind: 'heist'; bank: string; job?: Job; cost?: number };

export function contracted(c: Campaign, cmd: TestCommand): CampaignCommand {
    if (cmd.kind !== 'heist' || 'contract' in cmd) return cmd as CampaignCommand;
    const offer = c.contracts.find(k => !cmd.job || k.stakes === cmd.job.stakes) ?? c.contracts[0];
    return { ...cmd, contract: offer?.id ?? 'none' };
}

export const commit = (c: Campaign, cmd: TestCommand): ReturnType<typeof commitCampaign> => commitCampaign(c, contracted(c, cmd));
