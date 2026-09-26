import { store as appStore } from '$store/renderer/store';
import { selectCurrentConnectionId } from '$store/renderer/slices/connections/connections-selectors';
import { selectWorkspaceMentionMembers } from '$store/renderer/slices/presence/presence-selectors';
import type { MentionCandidate, Provider, SearchContext } from '../types';

/** Search the membership already hydrated by the presence saga; never fetch a roster per keystroke. */
export class MemberProvider implements Provider {
  id = 'member';

  getCacheKey(context: SearchContext): string {
    const state = appStore.state;
    return JSON.stringify({
      backendId: selectCurrentConnectionId.select(state),
      ownPrincipalId: state.presence.ownPrincipalId,
      members: context.workspaceId
        ? selectWorkspaceMentionMembers.select(state, context.workspaceId)
        : [],
    });
  }

  async search(query: string, context: SearchContext): Promise<MentionCandidate[]> {
    const { workspaceId } = context;
    if (!workspaceId) return [];
    const handleQuery = query.replace(/^@/, '').toLowerCase();
    return selectWorkspaceMentionMembers
      .select(appStore.state, workspaceId)
      .filter((member) => member.login.toLowerCase().includes(handleQuery))
      .map((member) => ({
        id: `member-${member.principalId}`,
        type: 'member',
        label: member.login,
        subtitle: member.identity
          ? `${member.identity.provider === 'github' ? 'GitHub' : 'GitLab'} · ${member.identity.host}` // i18n-ignore (forge brand and instance host)
          : undefined,
        description: member.displayName ?? undefined,
        icon: '👤',
        uri: `devspace://member/${encodeURIComponent(member.principalId)}?workspaceId=${encodeURIComponent(workspaceId)}`,
        score: 0.8,
        meta: {
          workspaceId,
          principalId: member.principalId,
          identity: member.identity,
          avatarUrl: member.avatarUrl ?? undefined,
        },
      }));
  }
}
