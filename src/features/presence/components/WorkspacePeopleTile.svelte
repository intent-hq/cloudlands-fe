<script lang="ts">
  import { writable } from 'svelte/store';
  import { store as appStore } from '$store/renderer/store';
  import { selectWorkspaceById } from '$store/renderer/slices/workspace/workspace-selectors';
  import { selectAllNotes } from '$store/renderer/slices/workspace-notes/workspace-notes-selectors';
  import { selectAllWorkspaceAgents } from '$store/renderer/slices/workspace-agents/workspace-agents-selectors';
  import { m } from '$shared/paraglide/messages.js';
  import { Card } from '$lib/components/ui/card';
  import { Button } from '$lib/components/ui/button';
  import { selectWorkspacePeopleInvites } from '$store/renderer/slices/workspace-share/workspace-share-selectors';
  import PrincipalAvatar from '$lib/components/ui/PrincipalAvatar.svelte';
  import PresenceAvatarStack from '$features/presence/components/PresenceAvatarStack.svelte';
  import {
    presencePersonNameWithForge,
    presencePersonLabel,
    type PresenceCircle,
    type PresenceCircleAction,
  } from '$features/presence/components/presence-person';
  import { selectWorkspacePeopleTilePeople } from '$store/renderer/slices/presence/presence-selectors';
  import {
    PRESENCE_FOLLOW_VISIBLE_LIMIT,
    selectPresenceFollowTargets,
  } from '$store/renderer/slices/presence-follow/presence-follow-selectors';
  import { followPresencePersonRequested } from '$store/renderer/slices/presence-follow/presence-follow-slice';
  import { findSourcePanelId } from '$lib/utils/workspace-navigation';
  import { isCmdClickModifier } from '$shared/utils/link-helpers';

  let {
    workspaceId,
    onExpand,
    compact = false,
  }: { workspaceId?: string; onExpand?: () => void; compact?: boolean } = $props();
  const workspaceIdStore = writable('');
  $effect(() => workspaceIdStore.set(workspaceId ?? ''));
  const workspace = selectWorkspaceById(workspaceIdStore);
  const notes = selectAllNotes(workspaceIdStore);
  const agents$ = selectAllWorkspaceAgents(workspaceIdStore);

  const peopleInvites$ = selectWorkspacePeopleInvites(workspaceIdStore);
  const presencePeople$ = selectWorkspacePeopleTilePeople(workspaceIdStore);
  const presenceFocusTargets$ = selectPresenceFollowTargets(workspaceIdStore);
  const presencePersonAction = $derived.by(() => {
    const targets = $presenceFocusTargets$;
    const agents = $agents$;
    const allNotes = $notes;
    const wsId = $workspace?.id ? String($workspace.id) : undefined;
    return (person: PresenceCircle): PresenceCircleAction => {
      const personName = person.hostRole
        ? presencePersonLabel(person)
        : presencePersonNameWithForge(person);
      const name =
        person.online && person.viewing === false
          ? m.workspace_peopleTile_inactive_tooltip({ name: personName })
          : personName;
      const entry = targets[person.principalId];
      const target = entry?.target;
      if (person.self || !entry || !target)
        return {
          label:
            !person.hostRole && !person.online
              ? m.workspace_progressCard_presenceOffline_tooltip({ name })
              : name,
          onSelect: null,
        };
      const sameWorkspace = target.workspaceId === wsId;
      const agent = sameWorkspace
        ? agents.find((s) => String(s.id) === target.agentId)?.name
        : undefined;
      const note = sameWorkspace
        ? allNotes.find((n) => String(n.id) === target.noteId)?.title
        : undefined;
      const viewLabel = target.agentId
        ? m.workspace_progressCard_presenceOnAgent_tooltip({
            name,
            agent: agent || m.layout_tabTypes_agent_title(),
          })
        : target.noteId
          ? m.workspace_progressCard_presenceOnNote_tooltip({
              name,
              note: note || m.layout_tabTypes_note_title(),
            })
          : name;
      return {
        label:
          !sameWorkspace || (!target.agentId && !target.noteId)
            ? m.workspace_progressCard_presenceAtWorkspace_tooltip({
                name: viewLabel,
                workspace: entry.workspaceTitle,
              })
            : viewLabel,
        onSelect: wsId
          ? (event) => {
              const current = selectPresenceFollowTargets.select(appStore.state, wsId)[
                person.principalId
              ];
              if (
                !current ||
                current.scope !== entry.scope ||
                current.generation !== entry.generation ||
                current.seq !== entry.seq
              )
                return;
              appStore.dispatch(
                followPresencePersonRequested(
                  entry.scope,
                  person.principalId,
                  entry.generation,
                  entry.seq,
                  crypto.randomUUID(),
                  findSourcePanelId(event.target),
                  isCmdClickModifier({ event }),
                ),
              );
            }
          : null,
      };
    };
  });
</script>

{#snippet avatars()}
  {@const avatarSize = compact ? 24 : 30}
  <div class="flex flex-wrap items-center gap-1.25">
    <PresenceAvatarStack
      class="relative z-10 w-fit"
      people={$presencePeople$}
      maxVisible={PRESENCE_FOLLOW_VISIBLE_LIMIT + ($presencePeople$[0]?.self ? 1 : 0)}
      size={avatarSize}
      variant="tile"
      action={presencePersonAction}
    />
    {#if $peopleInvites$.length > 0}
      <span
        class="pointer-events-none relative z-10 inline-flex items-center gap-1.25"
        data-people-invited
      >
        {#each $peopleInvites$.slice(0, 3) as invite (invite.id)}
          <PrincipalAvatar label={invite.pinLogin ?? ''} size={avatarSize} class="grayscale" />
        {/each}
        <span class="type-caption text-muted-foreground">{m.workspace_share_invited_label()}</span>
      </span>
    {/if}
  </div>
{/snippet}

{#if $presencePeople$.length > 0 || $peopleInvites$.length > 0}
  {#if compact}
    <div class="px-2 py-2" data-sidebar-people-tile>
      {@render avatars()}
    </div>
  {:else}
    <Card
      border="none"
      class="relative col-span-full min-h-[101px] w-full justify-between gap-5 rounded-lg border border-border bg-sidebar p-3.5"
      data-sidebar-people-tile
      data-sidebar-launcher={onExpand ? 'people' : undefined}
    >
      {#if onExpand}
        <Button
          variant="plain"
          class="absolute inset-0 z-0 h-auto cursor-pointer rounded-lg focus-visible:bg-muted/50"
          aria-label={m.workspace_peopleTile_title()}
          aria-expanded="false"
          onclick={onExpand}
          data-sidebar-people-open
        />
      {/if}
      {@render avatars()}
      <h2 class="type-caption font-semibold leading-5 text-foreground">
        {m.workspace_peopleTile_title()}
      </h2>
    </Card>
  {/if}
{/if}
