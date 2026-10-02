<script lang="ts">
  import { onDestroy } from 'svelte';
  import { store } from '$store/renderer/store';
  import type { Workspace } from '$shared/types';
  import { WorkspaceId } from '$shared/types/branded-ids';
  import { Button } from '$lib/components/ui/button';
  import {
    admitLegacyPrincipal,
    withHostPrincipal,
  } from '../../../../test/fixtures/principal-state';
  import {
    principalContextChanged,
    principalReceived,
  } from '$store/renderer/slices/principal/principal-slice';
  import { selectPrincipalActionContext } from '$store/renderer/slices/principal/principal-selectors';
  import { setLabsMultiplayerEnabled } from '$store/renderer/slices/user-preferences/user-preferences-slice';
  import { replaceWorkspaceList } from '$store/renderer/slices/workspace/workspace-slice';
  import {
    presenceContextReceived,
    presenceWorkspacesReceived,
    presenceMembersReceived,
    presenceRosterReceived,
    presenceReset,
  } from '$store/renderer/slices/presence/presence-slice';
  import { selectWorkspacePresencePeople } from '$store/renderer/slices/presence/presence-selectors';
  import type { WorkspaceMember } from '$store/renderer/slices/guest-sessions/guest-sessions-types';
  import PresenceAvatarStack from '../PresenceAvatarStack.svelte';
  import { presencePersonLabel, type PresenceCircle } from '../presence-person';

  let selected = $state('');
  store.dispatch(setLabsMultiplayerEnabled(true));
  admitLegacyPrincipal();
  const { principal } = withHostPrincipal(store.state);
  store.dispatch(principalContextChanged(principal.context));
  store.dispatch(
    principalReceived(
      { context: principal.context!, invalidation: 0, presentationVersion: 0 },
      principal.snapshot!,
    ),
  );
  const workspaceId = 'avatar-workspace';
  store.dispatch(
    replaceWorkspaceList([{ id: WorkspaceId(workspaceId), memberCount: 6 } as Workspace]),
  );
  store.dispatch(
    presenceContextReceived(selectPrincipalActionContext.select(store.state)!, 'principal'),
  );
  store.dispatch(presenceWorkspacesReceived([workspaceId]));
  const person = (
    principalId: string,
    hostRole: 'owner' | 'member' | 'guest',
  ): WorkspaceMember => ({
    principalId,
    hostRole,
    role: hostRole === 'owner' ? 'owner' : 'collaborator',
    login: principalId,
    displayName: null,
    avatarUrl: null,
    addedAt: '2026-09-30T00:00:00Z',
  });
  const members = [
    person('owner', 'owner'),
    person('member', 'member'),
    person('offline-host', 'member'),
    person('guest-online', 'guest'),
    person('guest-offline', 'guest'),
  ];
  store.dispatch(
    presenceMembersReceived(workspaceId, [...members, person('offline-host', 'guest')]),
  );
  store.dispatch(
    presenceRosterReceived({
      workspaceId,
      members: members
        .filter((p) => !p.principalId.startsWith('offline') && p.principalId !== 'guest-offline')
        .map((p) => ({
          ...p,
          focus: p.principalId === 'member' ? [{ workspaceId }] : [],
          typing: [],
        })),
    }),
  );
  const people$ = selectWorkspacePresencePeople(workspaceId);
  const action = (person: PresenceCircle) => ({
    label: presencePersonLabel(person),
    onSelect: () => {
      selected = person.principalId;
    },
  });
  onDestroy(() => store.dispatch(presenceReset()));
</script>

<section class="min-h-screen">
  <div class="min-h-screen bg-background p-6 text-foreground" data-testid="avatar-harness">
    <h1 class="mb-6 text-lg font-semibold">Workspace participants</h1>
    <PresenceAvatarStack people={$people$} maxVisible={4} size={18} {action} />
    <p class="mt-6" role="status">{selected}</p>
    <Button onclick={() => store.dispatch(setLabsMultiplayerEnabled(false))}
      >Disable Multiplayer</Button
    >
  </div>
</section>
