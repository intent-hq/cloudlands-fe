<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';

  type Scenario =
    | 'loading'
    | 'list'
    | 'multi-provider'
    | 'provider-error'
    | 'search-no-results'
    | 'empty'
    | 'error'
    | 'selected'
    | 'not-forked';

  interface Props {
    state?: Scenario;
  }

  export const preview = definePreview<Props>({
    id: 'import-session-picker',
    title: 'Import session picker',
    defaultState: 'list',
    states: {
      // First page still loading.
      loading: { props: { state: 'loading' } },
      // Newest first: provider icon and name, relative time, folder and branch on each row;
      // an undated session comes last without a date.
      list: { props: { state: 'list' } },
      // Several providers list sessions: the provider filter shows above the search.
      'multi-provider': { props: { state: 'multi-provider' } },
      // One provider failed to list: a quiet note under the rows, the list still works.
      'provider-error': { props: { state: 'provider-error' } },
      // A typed query that matches nothing.
      'search-no-results': { props: { state: 'search-no-results' } },
      // The daemon has no sessions (the form hides the option; the list still explains it).
      empty: { props: { state: 'empty' } },
      // The first page failed; Try again reloads it.
      error: { props: { state: 'error' } },
      // The form row once a session is picked, with the not-copied note.
      selected: { props: { state: 'selected' } },
      // After a load-only import (`forked: false`): the CLI session now continues in Intent.
      'not-forked': { props: { state: 'not-forked' } },
    },
  });
</script>

<script lang="ts">
  import { onDestroy, onMount, untrack } from 'svelte';
  import { store } from '$store/renderer/store';
  import { importableSessionsLoaded } from '$store/renderer/slices/importable-sessions/importable-sessions-slice';
  import { catalogNow } from '$lib/component-catalog/catalog-clock';
  import { notify } from '$lib/components/patterns/notify';
  import { Toast, toast } from '$lib/components/ui/toast';
  import { m } from '$shared/paraglide/messages.js';
  import ImportSessionList from './ImportSessionList.svelte';
  import ImportSessionPicker from './ImportSessionPicker.svelte';
  import {
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
    },
    {
      provider: 'claude-code',
      sessionId: '1f0c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f',
      title: 'Fix flaky upload retry test in the worker package',
      cwd: '/Users/sam/Projects/ember-cloudflare/apps/worker',
      updatedAt: ago(5 * 60 * minute),
      gitBranch: 'main',
    },
    {
      provider: 'claude-code',
      sessionId: '9a8b7c6d-5e4f-4a3b-2c1d-0e9f8a7b6c5d',
      title: '',
      cwd: '/home/sam/notes',
      updatedAt: ago(3 * 24 * 60 * minute),
    },
    {
      provider: 'claude-code',
      sessionId: '0d1e2f3a-4b5c-4d6e-7f8a-9b0c1d2e3f4a',
      title:
        'Investigate a very long rendering problem title that has to truncate in narrow layouts',
      cwd: '/Users/sam/Projects/a-repository-with-a-really-long-folder-name',
      updatedAt: ago(40 * 24 * 60 * minute),
      gitBranch: 'feature/a-branch-name-that-is-also-quite-long',
    },
    // No provider timestamp: the daemon lists it last and the row shows no date.
    {
      provider: 'claude-code',
      sessionId: '5c4b3a29-1807-4f6e-9d5c-4b3a2f1e0d9c',
      title: 'Sketch the onboarding copy',
      cwd: '/Users/sam/Projects/onboarding',
      updatedAt: null,
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
    },
    {
      provider: 'auggie',
      sessionId: 'b7e2f0aa-11c4-4d2e-9a77-3f1e0c9d2b10',
      title: 'Explain the search ranking pipeline',
      cwd: '/Users/sam/Projects/search',
      updatedAt: ago(2 * 24 * 60 * minute),
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
  const multi = untrack(() => scenario === 'multi-provider');
  const sessions = untrack(() =>
    multi
      ? // The daemon's order: newest first, undated last.
        [
          claudeSessions[0],
          otherSessions[0],
          claudeSessions[1],
          otherSessions[1],
          claudeSessions[2],
          claudeSessions[3],
          claudeSessions[4],
        ]
      : claudeSessions,
  );
  const providers = untrack(() =>
    scenario === 'multi-provider'
      ? providerList()
      : scenario === 'provider-error'
        ? providerList(true).filter((provider) => provider.id !== 'auggie')
        : [providerList()[0]],
  );
  const status = untrack(() =>
    scenario === 'loading' ? 'loading' : scenario === 'error' ? 'error' : 'ready',
  );
  const rows = untrack(() => (scenario === 'empty' || scenario === 'loading' ? [] : sessions));
  let inputRef = $state<HTMLInputElement | null>(null);
  let providerFilter = $state('');
  let picked = $state<SessionImportSelection | null>(
    untrack(() =>
      scenario === 'selected' || scenario === 'not-forked'
        ? toSessionImportSelection(claudeSessions[0])
        : null,
    ),
  );

  if (untrack(() => scenario === 'selected' || scenario === 'not-forked')) {
    store.dispatch(importableSessionsLoaded('', claudeSessions, providers));
    onDestroy(() => store.dispatch(importableSessionsLoaded('', [])));
  }

  const toasterId = 'import-session-preview';
  const toastId = 'import-session-not-forked';
  onMount(() => {
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
  class="w-full max-w-[480px] p-4 {scenario === 'not-forked' ? 'min-h-56' : ''}"
  data-testid="import-session-preview"
>
  {#if scenario === 'selected' || scenario === 'not-forked'}
    <ImportSessionPicker selected={picked} onSelect={(next) => (picked = next)} autoload={false} />
  {:else}
    <div
      class="flex h-[420px] w-110 max-w-full flex-col overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground"
    >
      <ImportSessionList
        {status}
        sessions={rows}
        {providers}
        {providerFilter}
        onproviderchange={(next) => (providerFilter = next)}
        bind:inputRef
        onselect={(session) => (picked = toSessionImportSelection(session))}
        onretry={() => {}}
      />
    </div>
  {/if}
  <output class="sr-only" data-testid="import-session-selection">{picked?.sessionId ?? ''}</output>
  {#if scenario === 'not-forked'}<Toast {toasterId} />{/if}
</section>
