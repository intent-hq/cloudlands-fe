<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import { Combobox, type ComboboxOption } from '$lib/components/ui/combobox';
  import { faHistory } from '$lib/icons/phosphor-icons';
  import { formatCompactRelativeTime, formatFullDateTime } from '$lib/i18n/format';
  import Fa from 'svelte-fa';
  import { m } from '$shared/paraglide/messages.js';
  import { workspacePickerStyles } from '$lib/components/workspace/initializer/workspace-picker-styles';
  import * as ToggleGroup from '$lib/components/ui/toggle-group';
  import AgentProviderIcon, {
    hasProviderIcon,
  } from '$features/agent/components/AgentProviderIcon.svelte';
  import type { ImportableSession, ImportableSessionProvider } from './importable-session';
  import { cwdBasename, sessionSearchText } from './utils/session-import-match';

  /**
   * New Workspace → Import a session: the searchable session list shown in
   * the picker popover. Presentational; the host owns loading and import.
   */
  interface Props {
    /** `loading` and `error` describe the first, unfiltered page. */
    status: 'loading' | 'ready' | 'error';
    sessions: ImportableSession[];
    /** Typed queries; the host also runs them on the daemon. Rows filter locally meanwhile. */
    onquerychange?: (query: string) => void;
    onselect: (session: ImportableSession) => void;
    onretry: () => void;
    onclose?: () => void;
    providerLabel?: (provider: string) => string;
    /** Providers the daemon listed; a filter shows when more than one can list. */
    providers?: ImportableSessionProvider[];
    /** Selected provider id; '' shows every provider. */
    providerFilter?: string;
    onproviderchange?: (provider: string) => void;
    open?: boolean;
    inputRef?: HTMLInputElement | null;
  }

  let {
    status,
    sessions,
    onquerychange,
    onselect,
    onretry,
    onclose,
    providerLabel,
    providers = [],
    providerFilter = '',
    onproviderchange,
    open = true,
    inputRef = $bindable(null),
  }: Props = $props();

  function optionFor(session: ImportableSession): ComboboxOption {
    return {
      value: `session:${session.provider}:${session.sessionId}`,
      label: session.title.trim() || m.sessionImport_list_untitled_label(),
      // Every searchable field, so the daemon's matches survive the row filter.
      description: sessionSearchText(session),
      data: session,
    };
  }

  const listedProviders = $derived(providers.filter((provider) => provider.status === 'ok'));
  const failedProviders = $derived(providers.filter((provider) => provider.status === 'error'));
  const options = $derived(
    sessions
      .filter((session) => !providerFilter || session.provider === providerFilter)
      .map(optionFor),
  );

  function labelFor(provider: string): string {
    return (
      providers.find((entry) => entry.id === provider)?.label ??
      providerLabel?.(provider) ??
      provider
    );
  }
  let query = $state('');

  /** The session's last write, or null for an undated session (no date shown). */
  function updatedDate(session: ImportableSession): Date | null {
    if (session.updatedAt === null) return null;
    const date = new Date(session.updatedAt);
    return Number.isNaN(date.getTime()) ? null : date;
  }
</script>

<div class="flex min-h-0 flex-1 flex-col" data-testid="import-session-list" data-status={status}>
  {#if listedProviders.length > 1 && status !== 'error'}
    <div class="shrink-0 overflow-x-auto px-2 pt-2" data-testid="import-session-provider-filter">
      <ToggleGroup.Root
        type="single"
        variant="flat"
        value={providerFilter || 'all'}
        onValueChange={(next: string) => onproviderchange?.(!next || next === 'all' ? '' : next)}
        aria-label={m.sessionImport_list_providerFilter_ariaLabel()}
      >
        <ToggleGroup.Item value="all" class="type-caption h-7 px-2"
          >{m.sessionImport_list_allProviders_label()}</ToggleGroup.Item
        >
        {#each listedProviders as provider (provider.id)}
          <ToggleGroup.Item value={provider.id} class="type-caption h-7 gap-1.5 px-2">
            {#if hasProviderIcon(provider.id)}
              <AgentProviderIcon providerId={provider.id} size={14} class="size-3.5" monochrome />
            {/if}
            <span class="whitespace-nowrap">{provider.label}</span>
          </ToggleGroup.Item>
        {/each}
      </ToggleGroup.Root>
    </div>
  {/if}
  {#if status === 'error'}
    <div class="flex flex-col items-start gap-2 px-4 py-3" role="alert">
      <p class="type-caption text-muted-foreground" data-testid="import-session-error">
        {m.sessionImport_list_loadFailed_error()}
      </p>
      <Button variant="ghost" size="sm" onclick={onretry}
        >{m.sessionImport_list_retry_label()}</Button
      >
    </div>
  {:else}
    <Combobox
      {options}
      {open}
      loading={status === 'loading'}
      bind:inputRef
      ariaLabel={m.sessionImport_list_ariaLabel()}
      placeholder={m.sessionImport_list_search_placeholder()}
      searchPlaceholder={m.sessionImport_list_search_placeholder()}
      emptyText={query.trim()
        ? m.sessionImport_list_noResults_message()
        : m.sessionImport_list_empty_message()}
      footer={failedProviders.length > 0 ? providerNotes : undefined}
      staticPosition
      inputVariant="search"
      size="compact"
      class="flex min-h-0 flex-1 flex-col gap-1 px-2 pt-1 pb-2"
      inputClass="shrink-0"
      rowClass="{workspacePickerStyles.row} flex-wrap"
      viewportClass="min-h-0 max-h-none flex-1 p-0"
      contentClass="flex min-h-0 max-h-none flex-1 flex-col border-0 shadow-none"
      onquerychange={(next) => {
        query = next;
        onquerychange?.(next);
      }}
      oncommit={(_, option) => onselect(option.data as ImportableSession)}
      onopenchange={(next) => {
        if (!next) onclose?.();
      }}
    >
      {#snippet optionIcon(option)}
        {@const provider = (option.data as ImportableSession).provider}
        {#if hasProviderIcon(provider)}
          <AgentProviderIcon providerId={provider} size={16} class="size-4" />
        {:else}
          <Fa icon={faHistory} class={workspacePickerStyles.icon} />
        {/if}
      {/snippet}
      {#snippet optionDescription(option)}
        {@const session = option.data as ImportableSession}
        {@const updated = updatedDate(session)}
        <span
          class="type-caption order-last flex min-w-0 basis-full items-center gap-1.5 ps-6 text-muted-foreground"
          data-testid="import-session-meta"
        >
          <span class="shrink-0">{labelFor(session.provider)}</span>
          {#if updated && session.updatedAt}
            <span aria-hidden="true">·</span>
            <time class="shrink-0" datetime={session.updatedAt} title={formatFullDateTime(updated)}
              >{formatCompactRelativeTime(updated)}</time
            >
          {/if}
          <span aria-hidden="true">·</span>
          <span class="min-w-0 truncate" title={session.cwd}>{cwdBasename(session.cwd)}</span>
          {#if session.gitBranch}
            <span aria-hidden="true">·</span>
            <span class="min-w-0 max-w-1/3 shrink truncate" title={session.gitBranch}
              >{session.gitBranch}</span
            >
          {/if}
        </span>
      {/snippet}
    </Combobox>
  {/if}
</div>

{#snippet providerNotes()}
  <div class="flex flex-col gap-0.5" data-testid="import-session-provider-notes">
    {#each failedProviders as provider (provider.id)}
      <p class="type-caption text-muted-foreground">
        {m.sessionImport_list_providerFailed_note({ provider: provider.label })}
      </p>
    {/each}
  </div>
{/snippet}
