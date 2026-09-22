<script lang="ts" module>
  import type { AvatarState } from '$features/agent/components/agent-avatar/avatar-state';

  export interface WarningAgent {
    id: string;
    name: string;
    specialist?: string | null;
    state: AvatarState;
  }
</script>

<script lang="ts">
  import AgentAvatarWithState from '$features/agent/components/agent-avatar/AgentAvatarWithState.svelte';
  import { getAgentAvatarStateLabel } from '$features/agent/components/agent-avatar/avatar-state-label';
  import HourglassMedium from 'phosphor-svelte/lib/HourglassMedium';
  import EnvelopeIcon from 'phosphor-svelte/lib/EnvelopeIcon';
  import UsersIcon from 'phosphor-svelte/lib/UsersIcon';
  import Fa from 'svelte-fa';
  import { faCodePullRequest } from '@fortawesome/free-solid-svg-icons';
  import { Badge } from '$lib/components/ui/badge';
  import { DestructiveConfirm } from '$lib/components/patterns/confirm';
  import { m } from '$shared/paraglide/messages.js';
  import { formatInteger } from '$lib/i18n/format';
  import { openExternalUrl } from '$lib/utils/open-external';
  import type { OpenPrWarningItem } from '$lib/utils/delete-warning-utils';
  import type {
    GuestsWarning,
    LocalChangesRoot,
    LocalChangesWarning,
  } from '$store/renderer/slices/workspace-operations/workspace-operations-types';

  interface Props {
    open?: boolean;
    static?: boolean;
    /** 'delete' (default) warns before a permanent delete; 'archive' before an archive. */
    mode?: 'delete' | 'archive';
    agents?: WarningAgent[];
    hookNames?: string[];
    openPrs?: OpenPrWarningItem[];
    /** `workspace.localChanges` result; null when unavailable (fail-open). */
    localChanges?: LocalChangesWarning | null;
    /** Collaborators and open invites the operation removes; null when unknown. */
    guests?: GuestsWarning | null;
    onDeleteAnyway?: () => void;
    onCancel?: () => void;
  }

  let {
    open = $bindable(false),
    static: staticPosition = false,
    mode = 'delete',
    agents = [],
    hookNames = [],
    openPrs = [],
    localChanges = null,
    guests = null,
    onDeleteAnyway,
    onCancel,
  }: Props = $props();

  const isArchive = $derived(mode === 'archive');
  const hasLocalChanges = $derived(
    localChanges != null && (localChanges.hasUnpushedCommits || localChanges.hasUncommittedChanges),
  );
  const collaboratorCount = $derived(guests?.collaboratorCount ?? 0);
  const openInviteCount = $derived(guests?.openInviteCount ?? 0);
  const hasGuests = $derived(collaboratorCount + openInviteCount > 0);
  const hasActiveWork = $derived(
    agents.length > 0 || hookNames.length > 0 || openPrs.length > 0 || hasLocalChanges,
  );
  // Guests are the only reason for the dialog: no work is stopped, so the copy must not claim it.
  const guestsOnly = $derived(hasGuests && !hasActiveWork);
  // Roots with local work; rows the daemon could not read carry `error` and are skipped.
  const localChangeRoots = $derived(
    hasLocalChanges
      ? (localChanges?.roots ?? []).filter(
          (root) => !root.error && (root.unpushedCount > 0 || root.uncommittedCount > 0),
        )
      : [],
  );

  function rootBranchLabel(root: LocalChangesRoot): string {
    return root.branch || m.workspace_branchDisplay_noBranch_label();
  }

  function rootLabel(root: LocalChangesRoot): string {
    if (root.kind === 'primary') return rootBranchLabel(root);
    const name = root.path.split(/[/\\]/).filter(Boolean).pop() || root.path;
    return m.modals_deleteWarning_localChanges_secondaryRoot_label({
      name,
      branch: rootBranchLabel(root),
    });
  }
  function close() {
    open = false;
    onCancel?.();
  }

  function handleDeleteAnyway() {
    onDeleteAnyway?.();
    open = false;
  }

  function handlePrLinkClick(event: MouseEvent, url: string) {
    event.preventDefault();
    // eslint-disable-next-line intent/no-component-async-data-fetch -- opens an external URL in the system browser, not a domain data fetch
    void openExternalUrl(url);
  }
</script>

<DestructiveConfirm
  class="[&_[data-slot=form]]:min-w-0"
  bind:open
  static={staticPosition}
  title={guestsOnly
    ? isArchive
      ? m.modals_archiveWarning_guestsOnly_title()
      : m.modals_deleteWarning_guestsOnly_title()
    : isArchive
      ? m.modals_archiveWarning_title()
      : m.modals_deleteWarning_title()}
  confirmLabel={guestsOnly
    ? isArchive
      ? m.modals_archiveWarning_guestsOnly_confirm_label()
      : m.modals_deleteWarning_guestsOnly_confirm_label()
    : isArchive
      ? m.modals_archiveWarning_confirm_label()
      : m.modals_deleteWarning_confirm_label()}
  cancelLabel={m.modals_deleteWarning_cancel_label()}
  closeLabel={isArchive
    ? m.modals_archiveWarning_close_ariaLabel()
    : m.modals_deleteWarning_close_ariaLabel()}
  onConfirm={handleDeleteAnyway}
  onCancel={close}
>
  {#snippet details()}
    <p class="type-body">
      {guestsOnly
        ? isArchive
          ? m.modals_archiveWarning_guestsOnly_description()
          : m.modals_deleteWarning_guestsOnly_description()
        : isArchive
          ? m.modals_archiveWarning_description()
          : m.modals_deleteWarning_description()}
    </p>
    <div class="min-w-0 space-y-4">
      {#if hasActiveWork || hasGuests}
        <div class="rounded-md border border-border bg-muted/40 p-3">
          {#if agents.length > 0}
            <p class="type-body text-muted-foreground font-normal">
              {agents.length === 1
                ? m.modals_deleteWarning_agentsStopped_one({
                    count: formatInteger(agents.length),
                  })
                : m.modals_deleteWarning_agentsStopped_many({
                    count: formatInteger(agents.length),
                  })}
            </p>
            <ul class="mt-2 grid max-h-40 gap-3 overflow-auto pr-1">
              {#each agents as agent (agent.id)}
                <li class="grid min-w-0 grid-cols-[2rem_minmax(0,1fr)] gap-x-2.5">
                  <span class="row-span-2 grid h-8 w-8 place-items-center" aria-hidden="true">
                    <AgentAvatarWithState
                      agentId={agent.id}
                      variant="emphasized"
                      state={agent.state}
                      specialist={agent.specialist ?? null}
                    />
                  </span>
                  <span class="type-body min-w-0 truncate text-foreground">{agent.name}</span>
                  <span class="type-caption min-w-0 truncate text-muted-foreground"
                    >{agent.specialist ? `${agent.specialist} · ` : ''}{getAgentAvatarStateLabel(
                      agent.state,
                    )}</span
                  >
                </li>
              {/each}
            </ul>
          {/if}
          {#if hookNames.length > 0}
            <p class="type-body text-muted-foreground font-normal" class:mt-4={agents.length > 0}>
              {hookNames.length === 1
                ? m.modals_deleteWarning_hooksCancelled_one({
                    count: formatInteger(hookNames.length),
                  })
                : m.modals_deleteWarning_hooksCancelled_many({
                    count: formatInteger(hookNames.length),
                  })}
            </p>
            <ul class="mt-2 max-h-28 space-y-1 overflow-auto pr-1">
              {#each hookNames as name}
                <li
                  class="type-body grid min-w-0 grid-cols-[2rem_minmax(0,1fr)] items-center gap-x-2.5 text-muted-foreground"
                >
                  <span class="grid h-8 w-8 place-items-center" aria-hidden="true"
                    ><HourglassMedium size={16} weight="regular" /></span
                  >
                  <span class="min-w-0 truncate">{name}</span>
                </li>
              {/each}
            </ul>
          {/if}
          {#if openPrs.length > 0}
            <p
              class="type-body text-muted-foreground font-normal"
              class:mt-4={agents.length > 0 || hookNames.length > 0}
            >
              {openPrs.length === 1
                ? m.modals_deleteWarning_openPrs_one({
                    count: formatInteger(openPrs.length),
                  })
                : m.modals_deleteWarning_openPrs_many({
                    count: formatInteger(openPrs.length),
                  })}
            </p>
            <ul class="mt-2 max-h-28 space-y-1 overflow-auto pr-1">
              {#each openPrs as pr (pr.url || pr.number)}
                <li
                  class="grid min-w-0 grid-cols-[2rem_minmax(0,1fr)_auto_auto] items-center gap-x-2.5"
                >
                  <Fa
                    icon={faCodePullRequest}
                    size={18}
                    class="shrink-0 justify-self-center {pr.status === 'Draft'
                      ? 'text-muted-foreground'
                      : 'text-success'}"
                  />
                  {#if pr.url}
                    <a
                      href={pr.url}
                      aria-label={`#${pr.number} ${pr.title}`}
                      class="type-body min-w-0 truncate text-foreground hover:underline"
                      onclick={(event) => handlePrLinkClick(event, pr.url)}
                    >
                      {pr.title}
                    </a>
                  {:else}
                    <span class="type-body min-w-0 truncate text-foreground">{pr.title}</span>
                  {/if}
                  <Badge variant={pr.status === 'Draft' ? 'secondary' : 'success'}>
                    {pr.status === 'Draft'
                      ? m.workspace_prSection_statusDraft_label()
                      : m.workspace_prSection_statusOpen_label()}
                  </Badge>
                  <span class="type-caption shrink-0 text-muted-foreground">#{pr.number}</span>
                  {#if pr.mergeConflicts === true}
                    <Badge
                      variant="destructive"
                      class="col-span-3 col-start-2 mt-1 justify-self-start"
                    >
                      {m.modals_deleteWarning_prMergeConflicts_label()}
                    </Badge>
                  {/if}
                </li>
              {/each}
            </ul>
          {/if}
          {#if hasLocalChanges}
            <p
              class="type-caption text-muted-foreground"
              class:mt-4={agents.length > 0 || hookNames.length > 0 || openPrs.length > 0}
            >
              {isArchive
                ? m.modals_archiveWarning_localChanges_description()
                : m.modals_deleteWarning_localChanges_description()}
            </p>
            <ul class="mt-2 max-h-28 space-y-1 overflow-auto pr-1">
              {#each localChangeRoots as root (root.gitRootId ?? root.path)}
                <li class="type-caption flex min-w-0 items-center gap-2 text-muted-foreground">
                  <span class="min-w-0 truncate">{rootLabel(root)}</span>
                  {#if root.unpushedCount > 0}
                    <Badge variant="secondary" class="shrink-0">
                      {root.unpushedCount === 1
                        ? m.modals_deleteWarning_localChanges_unpushed_one({
                            count: formatInteger(root.unpushedCount),
                          })
                        : m.modals_deleteWarning_localChanges_unpushed_many({
                            count: formatInteger(root.unpushedCount),
                          })}
                    </Badge>
                  {/if}
                  {#if root.uncommittedCount > 0}
                    <Badge variant="secondary" class="shrink-0">
                      {m.modals_deleteWarning_localChanges_uncommitted_label()}
                    </Badge>
                  {/if}
                </li>
              {/each}
            </ul>
          {/if}
          {#if hasGuests}
            <p class="type-body text-muted-foreground font-normal" class:mt-4={hasActiveWork}>
              {m.modals_deleteWarning_guests_description()}
            </p>
            <ul class="mt-2 space-y-1">
              {#if collaboratorCount > 0}
                <li
                  class="type-body grid min-w-0 grid-cols-[2rem_minmax(0,1fr)] items-center gap-x-2.5 text-muted-foreground"
                >
                  <span class="grid h-8 w-8 place-items-center" aria-hidden="true"
                    ><UsersIcon size={16} weight="regular" /></span
                  >
                  <span class="min-w-0 truncate">
                    {collaboratorCount === 1
                      ? m.modals_deleteWarning_guests_collaborators_one({
                          count: formatInteger(collaboratorCount),
                        })
                      : m.modals_deleteWarning_guests_collaborators_many({
                          count: formatInteger(collaboratorCount),
                        })}
                  </span>
                </li>
              {/if}
              {#if openInviteCount > 0}
                <li
                  class="type-body grid min-w-0 grid-cols-[2rem_minmax(0,1fr)] items-center gap-x-2.5 text-muted-foreground"
                >
                  <span class="grid h-8 w-8 place-items-center" aria-hidden="true"
                    ><EnvelopeIcon size={16} weight="regular" /></span
                  >
                  <span class="min-w-0 truncate">
                    {openInviteCount === 1
                      ? m.modals_deleteWarning_guests_openInvites_one({
                          count: formatInteger(openInviteCount),
                        })
                      : m.modals_deleteWarning_guests_openInvites_many({
                          count: formatInteger(openInviteCount),
                        })}
                  </span>
                </li>
              {/if}
            </ul>
          {/if}
        </div>
      {/if}

      <div class="space-y-1 text-sm leading-5 text-subtle">
        {#if isArchive}
          {#if !guestsOnly}
            <p>{m.modals_archiveWarning_note_description()}</p>
          {/if}
          {#if hasGuests}
            <p>{m.modals_archiveWarning_note_guests_description()}</p>
          {/if}
        {:else}
          <p>{m.modals_deleteWarning_permanent_description()}</p>
          {#if hasGuests}
            <p>{m.modals_deleteWarning_permanent_guests_description()}</p>
          {/if}
        {/if}
      </div>
    </div>
  {/snippet}
</DestructiveConfirm>
