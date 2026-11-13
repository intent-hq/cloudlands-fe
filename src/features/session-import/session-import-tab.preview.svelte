<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';

  type Scenario =
    | 'closed'
    | 'selector-browse'
    | 'selector-open'
    | 'selected'
    | 'loading'
    | 'list'
    | 'undated'
    | 'no-repo-root'
    | 'multi-provider'
    | 'provider-error'
    | 'search-no-results'
    | 'empty'
    | 'error'
    | 'not-forked';

  interface Props {
    state?: Scenario;
  }

  export const preview = definePreview<Props>({
    id: 'session-import-tab',
    title: 'Session import tab',
    defaultState: 'list',
    states: {
      // The codebase row before the picker opens: no session list request yet.
      closed: { props: { state: 'closed' } },
      // The codebase picker's first step: "Import a session" under "Add codebase".
      'selector-browse': { props: { state: 'selector-browse' } },
      // The codebase picker open on its Sessions tab, next to Clone / Existing folder / New.
      'selector-open': { props: { state: 'selector-open' } },
      // A picked session shows as the codebase, with its provider icon and the not-copied note.
      selected: { props: { state: 'selected' } },
      // First page still loading (the tab just opened).
      loading: { props: { state: 'loading' } },
      // Newest first: provider icon and name, relative time, folder and branch on each row.
      list: { props: { state: 'list' } },
      // Sessions without a provider timestamp: listed last, without a date.
      undated: { props: { state: 'undated' } },
      // Sessions without a codebase (folder gone or not a git repository): disabled, with a reason.
      'no-repo-root': { props: { state: 'no-repo-root' } },
      // Several providers list sessions: the provider filter shows above the search.
      'multi-provider': { props: { state: 'multi-provider' } },
      // One provider failed to list: a quiet note under the rows, the list still works.
      'provider-error': { props: { state: 'provider-error' } },
      // A typed query that matches nothing.
      'search-no-results': { props: { state: 'search-no-results' } },
      // The daemon has no sessions.
      empty: { props: { state: 'empty' } },
      // The first page failed; Try again reloads it.
      error: { props: { state: 'error' } },
      // After a load-only import (`forked: false`): the CLI session now continues in Intent.
      'not-forked': { props: { state: 'not-forked' } },
    },
  });
</script>

<script lang="ts">
  import { onDestroy, onMount, untrack } from 'svelte';
  import { store } from '$store/renderer/store';
  import {
    importableSessionsFailed,
    importableSessionsLoaded,
    importableSessionsLoading,
    importableSessionsReset,
  } from '$store/renderer/slices/importable-sessions/importable-sessions-slice';
  import { principalReceived } from '$store/renderer/slices/principal/principal-slice';
  import { catalogNow } from '$lib/component-catalog/catalog-clock';
  import { notify } from '$lib/components/patterns/notify';
  import { Toast, toast } from '$lib/components/ui/toast';
  import { m } from '$shared/paraglide/messages.js';
  import RepoSelector from '$lib/components/workspace/initializer/RepoSelector.svelte';
  import { setupRecentRepositoriesPreview } from '$lib/components/workspace/initializer/recent-repositories.preview-fixtures';
  import ImportSessionTab from './ImportSessionTab.svelte';
  import {
    importableSessionKey,
    toSessionImportSelection,
    type ImportableSession,
    type ImportableSessionProvider,
    type SessionImportSelection,
  } from './importable-session';

  let { state: scenario = 'list' }: Props = $props();

  const minute = 60_000;
  const ago = (ms: number) => new Date(catalogNow() - ms).toISOString();
  const claudeSessions: ImportableSession[] = [
    {
      provider: 'claude-code',
      sessionId: '6eca79e3-7963-44ad-b89e-e781d28df2b9',
      title: 'Cloudflare account installation',
      cwd: '/Users/sam/Projects/ember-cloudflare',
      updatedAt: ago(12 * minute),
      gitBranch: 'openid-sign-in',
      messageCount: 484,
      repoRoot: '/Users/sam/Projects/ember-cloudflare',
    },
    {
      provider: 'claude-code',
      sessionId: '1f0c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f',
      title: 'Fix flaky upload retry test in the worker package',
      cwd: '/Users/sam/Projects/ember-cloudflare/apps/worker',
      updatedAt: ago(5 * 60 * minute),
      gitBranch: 'main',
      repoRoot: '/Users/sam/Projects/ember-cloudflare',
    },
    {
      provider: 'claude-code',
      sessionId: '0d1e2f3a-4b5c-4d6e-7f8a-9b0c1d2e3f4a',
      title:
        'Investigate a very long rendering problem title that has to truncate in narrow layouts',
      cwd: '/Users/sam/Projects/a-repository-with-a-really-long-folder-name',
      updatedAt: ago(40 * 24 * 60 * minute),
      gitBranch: 'feature/a-branch-name-that-is-also-quite-long',
      repoRoot: '/Users/sam/Projects/a-repository-with-a-really-long-folder-name',
    },
  ];
  // No provider timestamp: the daemon lists them last and the rows show no date.
  const undatedSessions: ImportableSession[] = [
    {
      provider: 'claude-code',
      sessionId: '5c4b3a29-1807-4f6e-9d5c-4b3a2f1e0d9c',
      title: 'Sketch the onboarding copy',
      cwd: '/Users/sam/Projects/onboarding',
      updatedAt: null,
      gitBranch: 'main',
      repoRoot: '/Users/sam/Projects/onboarding',
    },
    {
      provider: 'claude-code',
      sessionId: '7a6b5c4d-3e2f-4a1b-9c8d-7e6f5a4b3c2d',
      title: '',
      cwd: '/Users/sam/Projects/onboarding/docs',
      updatedAt: null,
      repoRoot: '/Users/sam/Projects/onboarding',
    },
  ];
  // No `repoRoot` and no known repository holds the folder: disabled rows.
  const noRootSessions: ImportableSession[] = [
    {
      provider: 'claude-code',
      sessionId: '9a8b7c6d-5e4f-4a3b-2c1d-0e9f8a7b6c5d',
      title: 'Plan the week',
      cwd: '/Users/sam/notes',
      updatedAt: ago(3 * 24 * 60 * minute),
    },
    {
      provider: 'claude-code',
      sessionId: '3b2a1f0e-9d8c-4b7a-6f5e-4d3c2b1a0f9e',
      title: 'Old prototype in a deleted folder',
      cwd: '/Users/sam/Projects/removed-prototype',
      updatedAt: ago(9 * 24 * 60 * minute),
      gitBranch: 'main',
    },
  ];
  const otherSessions: ImportableSession[] = [
    {
      provider: 'codex',
      sessionId: 'rollout-2026-08-31T10-02-11-5b1c',
      title: 'Migrate the billing webhooks to the queue',
      cwd: '/Users/sam/Projects/billing',
      updatedAt: ago(40 * minute),
      gitBranch: 'queue-webhooks',
      repoRoot: '/Users/sam/Projects/billing',
    },
    {
      provider: 'auggie',
      sessionId: 'b7e2f0aa-11c4-4d2e-9a77-3f1e0c9d2b10',
      title: 'Explain the search ranking pipeline',
      cwd: '/Users/sam/Projects/search',
      updatedAt: ago(2 * 24 * 60 * minute),
      repoRoot: '/Users/sam/Projects/search',
    },
  ];
  // Brand names are not translated.
  const providerList = (failed = false): ImportableSessionProvider[] => [
    { id: 'claude-code', label: 'Claude Code', status: 'ok' }, // i18n-ignore (brand name)
    failed
      ? { id: 'codex', label: 'Codex', status: 'error', error: 'adapter timed out' } // i18n-ignore (brand name)
      : { id: 'codex', label: 'Codex', status: 'ok' }, // i18n-ignore (brand name)
    { id: 'auggie', label: 'Auggie', status: 'ok' }, // i18n-ignore (brand name)
  ];

  const rows = untrack((): ImportableSession[] => {
    switch (scenario) {
      case 'multi-provider':
        return [
          claudeSessions[0],
          otherSessions[0],
          claudeSessions[1],
          otherSessions[1],
          claudeSessions[2],
        ];
      case 'undated':
        return [claudeSessions[0], ...undatedSessions];
      case 'no-repo-root':
        return [claudeSessions[0], ...noRootSessions, claudeSessions[2]];
      case 'empty':
      case 'loading':
      case 'error':
      case 'closed':
      case 'selector-browse':
        return [];
      default:
        return [...claudeSessions, undatedSessions[0]];
    }
  });
  const providers = untrack(() =>
    scenario === 'multi-provider'
      ? providerList()
      : scenario === 'provider-error'
        ? providerList(true).filter((provider) => provider.id !== 'auggie')
        : [providerList()[0]],
  );
  const inSelector = untrack(
    () =>
      scenario === 'closed' ||
      scenario === 'selector-browse' ||
      scenario === 'selector-open' ||
      scenario === 'selected' ||
      scenario === 'not-forked',
  );

  // The selector scenes need the host's `sessionImport: 1` and the form fixtures.
  const cleanupFixture = inSelector ? setupRecentRepositoriesPreview() : null;
  if (inSelector) {
    const { context, snapshot, invalidation, presentationVersion } = store.state.principal;
    if (context && snapshot)
      store.dispatch(
        principalReceived(
          { context, invalidation, presentationVersion },
          { ...snapshot, capabilities: { ...snapshot.capabilities, sessionImport: 1 } },
        ),
      );
  }

  untrack(() => {
    if (scenario === 'loading') store.dispatch(importableSessionsLoading('', ''));
    else if (scenario === 'error')
      store.dispatch(importableSessionsFailed('', 'adapter failed to start'));
    else if (scenario !== 'closed' && scenario !== 'selector-browse')
      store.dispatch(importableSessionsLoaded('', rows, providers));
  });
  onDestroy(() => {
    store.dispatch(importableSessionsReset());
    cleanupFixture?.();
  });

  let inputRef = $state<HTMLInputElement | null>(null);
  let picked = $state<SessionImportSelection | null>(
    untrack(() =>
      scenario === 'selected' || scenario === 'not-forked'
        ? toSessionImportSelection(claudeSessions[0])
        : null,
    ),
  );
  let selector = $state<{ openOnSessionsTab: () => void } | undefined>();
  let section = $state<HTMLElement | undefined>();

  const toasterId = 'session-import-tab-preview';
  const toastId = 'session-import-tab-not-forked';
  onMount(() => {
    if (scenario === 'selector-open') {
      requestAnimationFrame(() => selector?.openOnSessionsTab());
    }
    if (scenario === 'selector-browse') {
      requestAnimationFrame(() =>
        section?.querySelector<HTMLButtonElement>('button[aria-labelledby]')?.click(),
      );
    }
    if (scenario !== 'not-forked') return;
    notify.info(m.sessionImport_create_notForked_info({ provider: 'Codex' }), {
      id: toastId,
      toasterId,
      duration: Number.POSITIVE_INFINITY,
    });
    return () => toast.dismiss(toastId);
  });

  // Type the query the scene is named for, through the real input path.
  $effect(() => {
    if (scenario !== 'search-no-results' || !inputRef) return;
    inputRef.value = 'kubernetes';
    inputRef.dispatchEvent(new Event('input', { bubbles: true }));
  });
</script>

<section
  class="w-full max-w-120 p-4 {scenario === 'not-forked'
    ? 'min-h-56'
    : scenario === 'selector-open' || scenario === 'selector-browse'
      ? 'min-h-140'
      : ''}"
  data-testid="session-import-tab-preview"
  bind:this={section}
>
  {#if inSelector}
    <div class="grid gap-1">
      <RepoSelector
        bind:this={selector}
        rowLabel={m.workspace_compactInitializer_repository_label()}
        value={picked?.repoRoot ?? ''}
        sessions={{ selected: picked, onSelect: (next) => (picked = next) }}
      />
      {#if picked}
        <p class="type-caption text-muted-foreground" data-testid="import-session-note">
          {m.sessionImport_picker_note_description()}
        </p>
      {/if}
    </div>
  {:else}
    <div
      class="flex h-105 w-110 max-w-full flex-col overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground"
    >
      <ImportSessionTab
        autoload={false}
        class="min-h-0 flex-1"
        bind:inputRef
        selectedKey={picked ? importableSessionKey(picked) : ''}
        onselect={(session) => (picked = session)}
      />
    </div>
  {/if}
  <output class="sr-only" data-testid="import-session-selection">{picked?.sessionId ?? ''}</output>
  {#if scenario === 'not-forked'}<Toast {toasterId} />{/if}
</section>
