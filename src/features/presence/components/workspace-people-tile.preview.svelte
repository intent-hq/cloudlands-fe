<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';

  interface Props {
    count?: number;
    offline?: boolean;
    roster?: 'mixed' | 'pending';
    sidebar?: boolean;
    shared?: boolean;
    expanded?: boolean;
    guest?: boolean;
    activityState?: 'ready' | 'empty' | 'loading' | 'error' | 'older' | 'older-empty' | 'grouped';
  }

  export const preview = definePreview<Props>({
    id: 'workspace-people-tile',
    title: 'Workspace people tile',
    defaultState: 'sidebar',
    states: {
      sidebar: { props: { sidebar: true } },
      mixed: { props: { sidebar: true, expanded: true, roster: 'mixed' } },
      pending: { props: { sidebar: true, shared: false, count: 1, roster: 'pending' } },
      tile: { props: {} },
      overflow: { props: { count: 8 } },
      offline: { props: { offline: true } },
      unshared: { props: { shared: false, sidebar: true } },
      expanded: { props: { sidebar: true, expanded: true } },
      grouped: { props: { sidebar: true, expanded: true, activityState: 'grouped' } },
      guest: { props: { sidebar: true, expanded: true, guest: true } },
      empty: { props: { sidebar: true, expanded: true, activityState: 'empty' } },
      loading: { props: { sidebar: true, expanded: true, activityState: 'loading' } },
      error: { props: { sidebar: true, expanded: true, activityState: 'error' } },
      older: { props: { sidebar: true, expanded: true, activityState: 'older' } },
      'older-empty': { props: { sidebar: true, expanded: true, activityState: 'older-empty' } },
    },
  });
</script>

<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import {
    sharePeopleInvitesLoaded,
    sharePeopleInvitesScopeChanged,
  } from '$store/renderer/slices/workspace-share/workspace-share-slice';
  import { selectWorkspaceInviteRead } from '$store/renderer/slices/workspace-share/workspace-share-selectors';
  import { selectPrincipalActionContext } from '$store/renderer/slices/principal/principal-selectors';
  import WorkspacePeopleTile from './WorkspacePeopleTile.svelte';
  import MultiSelectTabbedSidebar from '$lib/components/workspace/MultiSelectTabbedSidebar.svelte';
  import { store } from '$store/renderer/store';
  import { admitLegacyPrincipal } from '../../../test/fixtures/principal-state';
  import { selectPresenceContext } from '$store/renderer/slices/presence/presence-selectors';
  import {
    presenceContextReceived,
    presenceReset,
    presenceMembersReceived,
    presenceRosterReceived,
    presenceWorkspacesReceived,
  } from '$store/renderer/slices/presence/presence-slice';
  import {
    setWorkspaceEntity,
    removeWorkspaceEntity,
  } from '$store/renderer/slices/workspace/workspace-slice';
  import { setMultiSelectSidebarSelectedTabs } from '$store/renderer/slices/sidebar-nav/sidebar-nav-slice';
  import { setLabsMultiplayerEnabled } from '$store/renderer/slices/user-preferences/user-preferences-slice';
  import { WorkspaceStatus } from '$shared/types';
  import { WorkspaceId } from '$shared/types/branded-ids';
  import { PREVIEW_FIXTURE_TIMESTAMPS } from '$lib/component-catalog/preview-fixtures';
  import {
    eventsLoaded,
    eventsCleared,
    peopleEventsLoadStarted,
    peopleEventsPageLoaded,
    peopleEventsLoadFinished,
  } from '$store/renderer/slices/workspace-events/workspace-events-slice';
  import type { WorkspaceEvent } from '$features/events/types';

  let {
    count = 3,
    offline = false,
    roster,
    sidebar = false,
    shared = true,
    expanded = false,
    guest = false,
    activityState = 'ready',
  }: Props = $props();
  const workspaceId = 'people-tile-preview';
  const previousMultiplayer = store.state.userPreferences.labsMultiplayerEnabled;

  untrack(() => {
    store.dispatch(setLabsMultiplayerEnabled(true));
    admitLegacyPrincipal(guest ? 'guest' : 'owner');
    store.dispatch(
      setWorkspaceEntity({
        id: WorkspaceId(workspaceId),
        title: 'Redesign the workspace',
        repositoryName: 'intent',
        branch: 'feat/sidebar-people-tile',
        status: WorkspaceStatus.Active,
        myRole: guest ? 'collaborator' : 'owner',
        ownerPrincipalId: 'person-0',
        memberCount: shared ? Math.max(2, count) : 1,
        statusMessage: 'Bringing people and their work together.',
        changesets: [],
        timeline: [],
        conversationInfo: [],
        ...PREVIEW_FIXTURE_TIMESTAMPS,
      }),
    );
    store.dispatch(
      setMultiSelectSidebarSelectedTabs(workspaceId, [expanded ? 'people' : 'overview']),
    );
    store.dispatch(presenceContextReceived(selectPresenceContext.select(store.state)!, 'person-0'));
    store.dispatch(presenceWorkspacesReceived([workspaceId]));
    const names = ['Sam', 'Luke', 'Morgan', 'Taylor', 'Robin', 'Jamie', 'Casey', 'Charlie'];
    const people = names.slice(0, count).map((name, index) => ({
      principalId: `person-${index}`,
      login: name.toLowerCase(),
      displayName: name,
      avatarUrl:
        index === 0
          ? 'https://avatars.githubusercontent.com/u/84644?v=4'
          : index === 1
            ? 'https://avatars.githubusercontent.com/u/296156?v=4'
            : null,
      role: 'collaborator' as const,
      addedAt: PREVIEW_FIXTURE_TIMESTAMPS.createdAt,
    }));
    store.dispatch(presenceMembersReceived(workspaceId, people));
    store.dispatch(
      presenceRosterReceived({
        workspaceId,
        members: offline
          ? []
          : people
              .filter((_, index) => roster !== 'mixed' || index !== 2)
              .map((person, index) => ({
                ...person,
                focus: [
                  {
                    workspaceId:
                      roster === 'mixed' && index === 1 ? 'another-workspace' : workspaceId,
                  },
                ],
                typing: [],
              })),
      }),
    );
    const now = Date.now();
    if (roster) {
      store.dispatch(
        sharePeopleInvitesScopeChanged({
          context: selectPrincipalActionContext.select(store.state)!,
          workspaceIds: [workspaceId],
        }),
      );
      store.dispatch(
        sharePeopleInvitesLoaded({
          workspaceId,
          context: selectPrincipalActionContext.select(store.state)!,
          generation: selectWorkspaceInviteRead.select(store.state, workspaceId).generation,
          invites: [
            {
              id: 'amelia-invite',
              workspaceId,
              createdByPrincipalId: 'person-0',
              pinLogin: 'amelia',
              pinIdentity: { provider: 'github', host: 'github.com', externalUserId: '1042' },
              createdAt: new Date(now).toISOString(),
              expiresAt: new Date(now + 86400000).toISOString(),
            },
          ],
          receivedAt: now,
        }),
      );
    }
    const activity: WorkspaceEvent[] = [
      {
        id: 'people-activity-luke-message',
        workspaceId,
        type: 'agent:message',
        timestamp: new Date(now - 2 * 60_000).toISOString(),
        actor: { type: 'user', id: 'person-1', name: 'Luke' },
        data: { role: 'user', agentId: 'planner', messageId: 'message-2', author: people[1] },
      },
      {
        id: 'people-activity-luke-preview',
        workspaceId,
        type: 'agent:last-message' as WorkspaceEvent['type'],
        timestamp: new Date(now - 2 * 60_000).toISOString(),
        actor: { type: 'user', id: 'person-1', name: 'Luke' },
        data: {
          role: 'user',
          agentId: 'planner',
          messageId: 'message-2',
          lastMessageRole: 'user',
          lastMessageId: 'message-2',
          lastUserMessage:
            'Can we make each activity link jump to the original message in the conversation?',
          author: people[1],
        },
      },
      {
        id: 'people-activity-note',
        workspaceId,
        type: 'note:updated',
        timestamp: new Date(now - 5 * 60_000).toISOString(),
        actor: { type: 'user', id: 'person-1', name: 'Luke' },
        data: { noteId: 'sidebar-mockup', title: 'Sidebar mockup' },
      },
      {
        id: 'people-activity-comment',
        workspaceId,
        type: 'agent:message',
        timestamp: new Date(now - 12 * 60_000).toISOString(),
        actor: { type: 'user', id: 'person-0', name: 'Sam' },
        data: { role: 'user', agentId: 'planner', messageId: 'message-1', author: people[0] },
      },
      {
        id: 'people-activity-message-preview',
        workspaceId,
        type: 'agent:last-message' as WorkspaceEvent['type'],
        timestamp: new Date(now - 12 * 60_000).toISOString(),
        actor: { type: 'user', id: 'person-0', name: 'Sam' },
        data: {
          role: 'user',
          agentId: 'planner',
          messageId: 'message-1',
          lastMessageRole: 'user',
          lastMessageId: 'message-1',
          lastUserMessage: 'Let’s keep the People panel open while we review the sidebar together.',
          author: people[0],
        },
      },
      {
        id: 'people-activity-created',
        workspaceId,
        type: 'note:created',
        timestamp: new Date(now - 24 * 60_000).toISOString(),
        actor: { type: 'user', id: 'person-2', name: 'Morgan' },
        data: { noteId: 'group-chat', title: 'Group chat plan' },
      },
    ];
    if (activityState === 'grouped') {
      activity.push(
        ...[3, 12.5, 13.5].map((minutes) => ({
          id: `grouped-system-wake-${minutes}`,
          workspaceId,
          type: 'agent:message' as const,
          timestamp: new Date(now - minutes * 60_000).toISOString(),
          actor: { type: 'system' as const, id: 'system' },
          data: { role: 'user', agentId: 'planner', messageId: `wake-${minutes}` },
        })),
        ...[
          {
            id: 'grouped-workspace',
            minutes: 1,
            type: 'workspace:updated',
            data: { changes: { title: 'Sharing polish' } },
          },
          {
            id: 'grouped-agent',
            minutes: 1,
            type: 'agent:created',
            data: { agentId: 'reviewer', agentName: 'Design reviewer' },
          },
          { id: 'grouped-comment', minutes: 1, type: 'comment:added', data: { noteId: 'spec' } },
          {
            id: 'grouped-spec',
            minutes: 13,
            type: 'spec:updated',
            data: { section: 'Keyboard and screen reader access' },
          },
          {
            id: 'grouped-file',
            minutes: 14,
            type: 'file:changed',
            data: {
              path: 'src/features/presence/components/WorkspacePeopleActivity.svelte',
              action: 'modify',
            },
          },
          {
            id: 'grouped-old',
            minutes: 30,
            type: 'note:created',
            data: { noteId: 'old-plan', title: 'Earlier review' },
          },
        ].map(({ id, minutes, type, data }) => ({
          id,
          workspaceId,
          type: type as WorkspaceEvent['type'],
          timestamp: new Date(now - minutes * 60_000).toISOString(),
          actor: { type: 'user' as const, id: 'person-0', name: 'Sam' },
          data,
        })),
      );
    }
    store.dispatch(
      eventsLoaded(
        workspaceId,
        ['ready', 'older', 'grouped'].includes(activityState) ? activity : [],
        null,
      ),
    );
    store.dispatch(peopleEventsLoadStarted(workspaceId, 'preview-load'));
    if (activityState !== 'loading') {
      for (const stream of ['user', 'message'] as const) {
        store.dispatch(
          peopleEventsPageLoaded(
            workspaceId,
            'preview-load',
            stream,
            [],
            ['older', 'older-empty'].includes(activityState) ? `older-${stream}-page` : null,
          ),
        );
      }
      store.dispatch(
        peopleEventsLoadFinished(
          workspaceId,
          'preview-load',
          true,
          activityState === 'error' ? 'Activity could not be loaded.' : null,
        ),
      );
    }
  });

  onDestroy(() => {
    store.dispatch(sharePeopleInvitesScopeChanged({ context: null, workspaceIds: [] }));
    store.dispatch(presenceReset());
    store.dispatch(setLabsMultiplayerEnabled(previousMultiplayer));
    store.dispatch(removeWorkspaceEntity(workspaceId));
    store.dispatch(eventsCleared(workspaceId));
  });
</script>

{#if sidebar}
  <div class="h-[780px] w-full max-w-[346px] bg-sidebar" data-people-sidebar-preview>
    <MultiSelectTabbedSidebar {workspaceId} />
  </div>
{:else}
  <div class="w-full max-w-[298px]" data-people-tile-preview>
    <WorkspacePeopleTile {workspaceId} />
  </div>
{/if}
