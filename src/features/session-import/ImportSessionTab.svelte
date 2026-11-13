<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import { faArrowsRotate } from '$lib/icons/phosphor-icons';
  import Fa from 'svelte-fa';
  import { m } from '$shared/paraglide/messages.js';
  import { store as appStore } from '$store/renderer/store';
  import { importableSessionsRequested } from '$store/renderer/slices/importable-sessions/importable-sessions-slice';
  import {
    selectImportableSessionProviders,
    selectImportableSessions,
    selectImportableSessionsStatus,
  } from '$store/renderer/slices/importable-sessions/importable-sessions-selectors';
  import { selectProviderDisplayName } from '$store/renderer/slices/provider-catalog/provider-catalog-selectors';
  import ImportSessionList from './ImportSessionList.svelte';
  import {
    toSessionImportSelection,
    type ImportableSession,
    type SessionImportSelection,
  } from './importable-session';
  import { sessionCodebaseRoot, type SessionRepoCandidate } from './utils/session-import-match';

  /**
   * The Sessions tab body (codebase selector and onboarding). The list request
   * runs only once this tab is first shown; the rows stay while the owning
   * dialog is open (the owner resets them on close), with Refresh to re-list.
   * Picking a session picks its codebase: the daemon's `repoRoot`, or a known
   * repository holding its folder when the daemon predates `repoRoot`.
   */
  interface Props {
    onselect: (session: SessionImportSelection) => void;
    /** Known local repositories, the fallback when a row has no `repoRoot`. */
    knownRepos?: readonly SessionRepoCandidate[];
    /** Key (`provider:sessionId`) of the picked session. */
    selectedKey?: string;
    /** Load the first page when shown (previews seed the store instead). */
    autoload?: boolean;
    inputRef?: HTMLInputElement | null;
    onclose?: () => void;
    class?: string;
  }

  let {
    onselect,
    knownRepos = [],
    selectedKey = '',
    autoload = true,
    inputRef = $bindable(null),
    onclose,
    class: className = '',
  }: Props = $props();

  const sessions$ = selectImportableSessions();
  const status$ = selectImportableSessionsStatus();
  const providers$ = selectImportableSessionProviders();
  let providerFilter = $state('');
  let query = '';

  // The first page shows the loading row; a typed search keeps the rows,
  // filtered locally, until the daemon's matches arrive.
  const listStatus = $derived(
    $status$ === 'error'
      ? 'error'
      : ($status$ === 'loading' || $status$ === 'idle') && $sessions$.length === 0
        ? 'loading'
        : 'ready',
  );

  function request(next: string, provider = providerFilter) {
    query = next;
    appStore.dispatch(importableSessionsRequested(next, provider || undefined));
  }

  onMount(() => {
    if (!autoload) return;
    const slice = appStore.state.importableSessions;
    // Kept rows of the unfiltered list are reused; anything else re-lists.
    const kept =
      slice &&
      (slice.status === 'ready' || slice.status === 'loading') &&
      slice.query === '' &&
      slice.provider === '';
    if (!kept) untrack(() => request(''));
  });

  function providerLabel(provider: string): string {
    return selectProviderDisplayName.select(appStore.state, provider);
  }

  function rootFor(session: ImportableSession): string | null {
    return sessionCodebaseRoot(session, knownRepos);
  }

  function disabledReason(session: ImportableSession): string | null {
    return rootFor(session) ? null : m.sessionImport_list_noRepository_reason();
  }

  function pick(session: ImportableSession) {
    const root = rootFor(session);
    if (!root) return;
    onselect(toSessionImportSelection(session, root));
  }
</script>

<div class="flex min-h-0 flex-col {className}" data-testid="import-session-tab">
  <ImportSessionList
    status={listStatus}
    sessions={$sessions$}
    {providerLabel}
    providers={$providers$}
    {providerFilter}
    onproviderchange={(provider) => {
      providerFilter = provider;
      request(query, provider);
    }}
    bind:inputRef
    onquerychange={request}
    onselect={pick}
    onretry={() => request(query)}
    {onclose}
    {disabledReason}
    {selectedKey}
  />
  {#if listStatus !== 'error'}
    <div class="flex shrink-0 justify-end border-t border-border px-2 py-1">
      <Button
        variant="ghost"
        size="sm"
        type="button"
        disabled={$status$ === 'loading'}
        onclick={() => request(query)}
        data-testid="import-session-refresh"
      >
        <Fa icon={faArrowsRotate} class="size-3.5" />
        {m.sessionImport_list_refresh_label()}
      </Button>
    </div>
  {/if}
</div>
