<script lang="ts">
  import {
    Button,
    Input,
    Skeleton,
    Switch,
  } from '$lib/components/patterns/settings/custom-controls';
  import { ListRow, RowActions, type ActionDefinition } from '$lib/components/patterns/collection';
  import { truncatedTitle } from '$lib/actions/observe-overflow';
  import { crispOut, springIn } from '$lib/motion';
  import {
    faChevronDown,
    faPuzzlePiece,
    faRotateRight,
    faTrash,
  } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import { m } from '$shared/paraglide/messages.js';
  import { formatInteger } from '$lib/i18n/format';
  import type { PluginInfo } from '$lib/client/live/live-plugins-client';

  interface Props {
    plugins: PluginInfo[];
    loading?: boolean;
    loadError?: string | null;
    installing?: boolean;
    installError?: string | null;
    /** Name of the plugin with an action in flight. */
    busy?: string | null;
    rowError?: { name: string; message: string } | null;
    onInstall: (source: string) => void;
    onToggle: (name: string, enabled: boolean) => void;
    onUpdate: (name: string) => void;
    onUninstall: (name: string) => void;
  }

  let {
    plugins,
    loading = false,
    loadError = null,
    installing = false,
    installError = null,
    busy = null,
    rowError = null,
    onInstall,
    onToggle,
    onUpdate,
    onUninstall,
  }: Props = $props();

  let source = $state('');
  let expanded = $state<Record<string, boolean>>({});

  // A successful install clears the field; a failed one keeps the draft.
  let wasInstalling = false;
  $effect(() => {
    if (wasInstalling && !installing && !installError) source = '';
    wasInstalling = installing;
  });

  function submit(event: SubmitEvent) {
    event.preventDefault();
    const value = source.trim();
    if (value && !installing) onInstall(value);
  }

  function summary(plugin: PluginInfo): string {
    const parts: string[] = [];
    if (plugin.skills.length > 0) {
      parts.push(
        plugin.skills.length === 1
          ? m.settings_plugins_skillCount_one()
          : m.settings_plugins_skillCount_many({ count: formatInteger(plugin.skills.length) }),
      );
    }
    if (plugin.mcpServers.length > 0) {
      parts.push(
        plugin.mcpServers.length === 1
          ? m.settings_plugins_serverCount_one()
          : m.settings_plugins_serverCount_many({
              count: formatInteger(plugin.mcpServers.length),
            }),
      );
    }
    return parts.join(' · ');
  }

  function hasDetails(plugin: PluginInfo): boolean {
    return plugin.skills.length + plugin.mcpServers.length + plugin.diagnostics.length > 0;
  }

  function actionsFor(plugin: PluginInfo): ActionDefinition[] {
    return [
      ...(plugin.source
        ? [{ id: 'update', label: m.settings_plugins_action_update(), icon: faRotateRight }]
        : []),
      {
        id: 'uninstall',
        label: m.settings_plugins_action_uninstall(),
        icon: faTrash,
        destructive: true,
        group: 'danger',
      },
    ];
  }

  function handleAction(plugin: PluginInfo, action: string) {
    if (action === 'update') onUpdate(plugin.name);
    if (action === 'uninstall') onUninstall(plugin.name);
  }
</script>

<section class="bg-card rounded-xl divide-y divide-border overflow-hidden">
  <div data-slot="settings-section-body" class="px-6 py-4">
    <p class="type-body text-muted-foreground">{m.settings_plugins_description()}</p>
    <form class="mt-3 flex items-center gap-2" onsubmit={submit}>
      <Input
        class="flex-1"
        bind:value={source}
        placeholder={m.settings_plugins_source_placeholder()}
        aria-label={m.settings_plugins_source_placeholder()}
        disabled={installing}
        spellcheck={false}
        autocomplete="off"
      />
      <Button type="submit" variant="secondary" size="sm" disabled={!source.trim() || installing}>
        {installing ? m.settings_plugins_installing() : m.settings_plugins_install()}
      </Button>
    </form>
    {#if installError}
      <p role="alert" class="mt-2 type-body text-danger" data-testid="plugin-install-error">
        {installError}
      </p>
    {/if}
  </div>

  <div data-slot="settings-section-body" class="px-6 py-2">
    {#if loading}
      {#each [1, 2] as row (row)}
        <div class="flex items-start gap-3 py-3">
          <Skeleton class="w-5 h-5 rounded-md mt-0.5" />
          <div class="flex-1 min-w-0">
            <Skeleton class="h-4 w-28 mb-1.5" />
            <Skeleton class="h-3 w-48" />
          </div>
          <Skeleton class="w-9 h-5 rounded-full" />
        </div>
      {/each}
    {:else if loadError}
      <p role="alert" class="py-3 type-body text-danger">{loadError}</p>
    {:else if plugins.length === 0}
      <p class="py-3 type-body text-muted-foreground">{m.settings_plugins_empty()}</p>
    {:else}
      {#each plugins as plugin (plugin.name)}
        {@const invalid = plugin.status === 'invalid'}
        {@const open = expanded[plugin.name] === true}
        <div class="group/collection-row" data-testid="plugin-row">
          <ListRow class="items-start px-0">
            {#snippet leading()}
              <div class="mt-0.5 flex h-5 w-5 items-center justify-center text-muted-foreground">
                <Fa icon={faPuzzlePiece} size="sm" />
              </div>
            {/snippet}
            {#snippet title()}
              <span class="block truncate type-body font-medium" use:truncatedTitle={plugin.name}
                >{plugin.name}</span
              >
            {/snippet}
            {#snippet meta()}
              <span class="flex items-center gap-2">
                {#if plugin.version}
                  <span class="type-caption text-subtle">{plugin.version}</span>
                {/if}
                {#if invalid}
                  <span class="text-ui-sm px-1.5 py-0.5 rounded-full text-danger bg-danger/10">
                    {m.settings_plugins_status_invalid()}
                  </span>
                {:else if plugin.diagnostics.length > 0}
                  <span
                    class="text-ui-sm px-1.5 py-0.5 rounded-full text-warning-ink bg-warning/10"
                  >
                    {plugin.diagnostics.length === 1
                      ? m.settings_plugins_warningCount_one()
                      : m.settings_plugins_warningCount_many({
                          count: formatInteger(plugin.diagnostics.length),
                        })}
                  </span>
                {/if}
              </span>
            {/snippet}
            {#snippet description()}
              <div class="min-w-0">
                {#if invalid}
                  <p class="type-body text-danger line-clamp-2">{plugin.error}</p>
                {:else if plugin.description}
                  <p class="type-body truncate text-muted-foreground">{plugin.description}</p>
                {/if}
                {#if rowError?.name === plugin.name}
                  <p role="alert" class="mt-1 type-body text-danger line-clamp-2">
                    {rowError.message}
                  </p>
                {/if}
                {#if !invalid && hasDetails(plugin)}
                  <Button
                    variant="plain"
                    size="xs"
                    class="mt-1 h-auto type-body text-muted-foreground hover:text-foreground"
                    aria-expanded={open}
                    onclick={() => (expanded = { ...expanded, [plugin.name]: !open })}
                  >
                    <span>{summary(plugin) || m.settings_plugins_details()}</span>
                    <div
                      class="transition-transform duration-spring-moderate ease-spring-moderate motion-reduce:transition-none {open
                        ? ''
                        : '-rotate-90'}"
                    >
                      <Fa icon={faChevronDown} size="xs" />
                    </div>
                  </Button>
                {/if}
              </div>
            {/snippet}
            {#snippet trailing()}
              <div class="flex items-center gap-1">
                <RowActions
                  actions={actionsFor(plugin)}
                  onAction={(action) => handleAction(plugin, action)}
                  visibleCount={0}
                  overflowLabel={m.settings_plugins_actionsFor_ariaLabel({ name: plugin.name })}
                />
                <Switch
                  checked={plugin.enabled && !invalid}
                  disabled={invalid || busy === plugin.name}
                  aria-label={m.settings_plugins_toggle_ariaLabel({ name: plugin.name })}
                  onCheckedChange={(checked) => onToggle(plugin.name, checked)}
                  size="sm"
                />
              </div>
            {/snippet}
          </ListRow>

          {#if open && !invalid}
            <div
              in:springIn={{ tier: 'moderate', y: -4 }}
              out:crispOut={{ tier: 'moderate' }}
              class="pl-8 pb-3 space-y-2 type-body"
            >
              {#if plugin.skills.length > 0}
                <div>
                  <p class="type-caption text-subtle">{m.settings_plugins_skills()}</p>
                  <p class="text-foreground">
                    {plugin.skills.map((skill) => `${plugin.name}:${skill}`).join(', ')}
                  </p>
                </div>
              {/if}
              {#if plugin.mcpServers.length > 0}
                <div>
                  <p class="type-caption text-subtle">{m.settings_plugins_servers()}</p>
                  {#each plugin.mcpServers as server (server.name)}
                    <p class="text-foreground">
                      {server.sessionName}
                      <span class="text-subtle">· {server.transport}</span>
                    </p>
                  {/each}
                </div>
              {/if}
              {#if plugin.diagnostics.length > 0}
                <div>
                  <p class="type-caption text-subtle">{m.settings_plugins_warnings()}</p>
                  {#each plugin.diagnostics as diagnostic, index (index)}
                    <p class="text-warning-ink">{diagnostic}</p>
                  {/each}
                </div>
              {/if}
            </div>
          {/if}
        </div>
      {/each}
    {/if}
  </div>
</section>
