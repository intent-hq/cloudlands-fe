<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';

  interface Props {
    goal?: string;
    readonly?: boolean;
    /** Who set the goal in a shared workspace; omitted = personal workspace. */
    setBy?: 'member' | 'self' | 'former';
  }

  // i18n-ignore (sample goal text supplied as fixture content)
  const shortGoal = 'Ship the conversation goal UI behind the capability gate.';
  const longGoal =
    'Ship the conversation goal UI behind the conversationGoal capability gate, keep the composer text on refusal, render goal notices in transcript order, and verify the strip at narrow widths in both themes before review.';
  const linkedGoal =
    'Follow the contract in https://github.com/intent-hq/intent/pull/9896\nThen land the intentd PR before the desktop PR.';

  export const preview = definePreview<Props>({
    id: 'goal-strip',
    title: 'Conversation goal strip',
    defaultState: 'short',
    states: {
      short: { props: { goal: shortGoal } },
      long: { props: { goal: longGoal } },
      links: { props: { goal: linkedGoal } },
      readonly: { props: { goal: longGoal, readonly: true } },
      'shared-member': { props: { goal: shortGoal, setBy: 'member' } },
      'shared-self': { props: { goal: shortGoal, setBy: 'self' } },
      'shared-former': { props: { goal: longGoal, setBy: 'former' } },
    },
  });
</script>

<script lang="ts">
  import { store } from '$store/renderer/store';
  import { AgentStatus, WorkspaceStatus, type AgentSession } from '$shared/types';
  import { AgentId, WorkspaceId } from '$shared/types/branded-ids';
  import { bulkUpsertSessions } from '$store/renderer/slices/agent-session/agent-session-slice';
  import { admitLegacyPrincipal } from '../../../test/fixtures/principal-state';
  import { setWorkspaceEntity } from '$store/renderer/slices/workspace/workspace-slice';
  import GoalStrip from './GoalStrip.svelte';
  import GoalNotice from './GoalNotice.svelte';
  import {
    presenceContextReceived,
    presenceMembersReceived,
    presenceWorkspacesReceived,
  } from '$store/renderer/slices/presence/presence-slice';
  import type { WorkspaceMember } from '$store/renderer/slices/guest-sessions/guest-sessions-types';
  import type { GoalSetBy } from '$shared/types/agent-session';

  let { goal = '', readonly = false, setBy }: Props = $props();
  const workspaceId = 'preview-goal-strip';
  const agentId = 'preview-goal-agent';
  const createdAt = '2026-11-22T08:00:00Z';

  admitLegacyPrincipal('owner', { conversationGoal: 1 });

  // i18n-ignore (sample member names supplied as fixture content)
  const ownPrincipalId = 'preview-goal-me';
  const rosterMember = (principalId: string, displayName: string, login: string) =>
    ({
      principalId,
      displayName,
      login,
      avatarUrl: null,
      role: 'collaborator',
      addedAt: createdAt,
    }) as WorkspaceMember;
  const setters: Record<NonNullable<Props['setBy']>, GoalSetBy> = {
    member: { principalId: 'preview-goal-alice', displayName: 'Alice Rivera', login: 'alice' },
    self: { principalId: ownPrincipalId, displayName: 'Sam Lee', login: 'sam' },
    former: { principalId: 'preview-goal-left', displayName: null, login: null },
  };
  const goalSetBy = $derived(setBy ? setters[setBy] : undefined);

  // A shared workspace (memberCount 2) with a known roster; personal otherwise.
  $effect(() => {
    const shared = !!setBy;
    store.dispatch(
      setWorkspaceEntity({
        id: WorkspaceId(workspaceId),
        title: 'Conversation goal',
        branch: 'preview',
        path: '/preview/project',
        changesets: [],
        timeline: [],
        conversationInfo: [],
        status: WorkspaceStatus.Active,
        createdAt,
        updatedAt: createdAt,
        memberCount: shared ? 2 : 1,
      }),
    );
    if (!shared) return;
    store.dispatch(presenceContextReceived('preview-goal-strip', ownPrincipalId));
    store.dispatch(presenceWorkspacesReceived([workspaceId]));
    store.dispatch(
      presenceMembersReceived(workspaceId, [
        rosterMember(ownPrincipalId, 'Sam Lee', 'sam'),
        rosterMember('preview-goal-alice', 'Alice Rivera', 'alice'),
      ]),
    );
  });

  $effect(() => {
    store.dispatch(
      bulkUpsertSessions(
        [
          {
            id: AgentId(agentId),
            backendSessionId: null,
            workspaceId: WorkspaceId(workspaceId),
            name: 'Developer',
            status: AgentStatus.Idle,
            messages: [],
            createdAt,
            updatedAt: createdAt,
            goal,
            ...(goalSetBy ? { goalSetBy } : {}),
          } as unknown as AgentSession,
        ],
        { preserveExplicitRuntimeFlags: true },
      ),
    );
  });
</script>

<div class="flex w-full flex-col gap-4 bg-background p-4 text-foreground">
  <div class="rounded-md border border-border">
    <GoalStrip {workspaceId} {agentId} {readonly} />
    <div class="h-16"></div>
  </div>
  <GoalNotice
    notice={{
      action: 'shown',
      goal,
      ...(goalSetBy ? { fromPrincipalId: goalSetBy.principalId } : {}),
    }}
    {workspaceId}
    {agentId}
    {readonly}
  />
  <GoalNotice notice={{ action: 'cleared', goal: null }} {workspaceId} {agentId} {readonly} />
</div>
