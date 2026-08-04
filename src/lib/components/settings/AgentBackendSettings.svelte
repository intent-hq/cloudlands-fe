<script lang="ts">
  /**
   * Agent Backend Settings Component
   *
   * Daemon-side agent configuration:
   * - agents.maxConcurrent: concurrent agent session cap
   * - agents.flushQueuedMessages: batch-deliver queued messages when a turn ends
   */

  import { appClient } from '$lib/client';
  import { onMount } from 'svelte';
  import { m } from '$shared/paraglide/messages.js';
  import { formatInteger } from '$lib/i18n/format';
  import { Input } from '$lib/components/ui/input';
  import { Select } from '$lib/components/ui/select';

  type FlushQueuedMessagesMode = 'all' | 'systemOnly' | 'off';

  const FLUSH_MODES: FlushQueuedMessagesMode[] = ['all', 'systemOnly', 'off'];

  function isFlushMode(value: unknown): value is FlushQueuedMessagesMode {
    return typeof value === 'string' && (FLUSH_MODES as string[]).includes(value);
  }

  // Settings state
  let maxConcurrent = $state(0);
  let inputValue = $state('');
  let flushQueuedMessages = $state<FlushQueuedMessagesMode>('all');
  let settingsError = $state('');

  const SETTING_PATH = 'agents.maxConcurrent';
  const FLUSH_SETTING_PATH = 'agents.flushQueuedMessages';

  const flushModeOptions = $derived([
    { value: 'all', label: m.settings_agentBackend_flushQueuedMessages_all_label() },
    { value: 'systemOnly', label: m.settings_agentBackend_flushQueuedMessages_systemOnly_label() },
    { value: 'off', label: m.settings_agentBackend_flushQueuedMessages_off_label() },
  ]);

  const flushModeLabel = $derived(
    flushModeOptions.find((option) => option.value === flushQueuedMessages)?.label ??
      flushQueuedMessages,
  );

  onMount(async () => {
    await loadSettings();
  });

  async function loadSettings() {
    // The live client folds read failures to an empty list rather than
    // throwing, so an empty result is the load-failure signal (the daemon
    // always reports its setting catalog) — same pattern as
    // GitWorkspaceSettings.
    const settings = await appClient.settings.list();
    if (settings.length === 0) {
      settingsError = m.settings_agentBackend_loadError();
      return;
    }
    settingsError = '';
    const byPath = new Map(settings.map((entry) => [entry.path, entry.value]));
    const value = byPath.get(SETTING_PATH);
    maxConcurrent = typeof value === 'number' ? value : 0;
    // Display empty for 0 (Auto)
    inputValue = maxConcurrent === 0 ? '' : String(maxConcurrent);
    // Unknown/absent value (e.g. legacy boolean or missing setting) falls back
    // to the daemon default of `all`.
    const flushValue = byPath.get(FLUSH_SETTING_PATH);
    flushQueuedMessages = isFlushMode(flushValue) ? flushValue : 'all';
  }

  async function handleFlushModeChange(value: string) {
    if (!isFlushMode(value) || value === flushQueuedMessages) return;
    try {
      const applied = await appClient.settings.update([
        { path: FLUSH_SETTING_PATH, value },
      ]);
      // Only commit local state from the daemon-acknowledged value; a success
      // response that did not apply this path (e.g. an older daemon) keeps the
      // current state and surfaces the save error.
      const entry = applied.find((change) => change.path === FLUSH_SETTING_PATH);
      if (!entry || !isFlushMode(entry.value)) {
        settingsError = m.settings_agentBackend_saveError();
        return;
      }
      flushQueuedMessages = entry.value;
      settingsError = '';
    } catch (error) {
      settingsError = m.settings_agentBackend_saveError();
      console.error('Failed to save agent settings:', error);
    }
  }

  function handleInput(event: Event) {
    const target = event.target as HTMLInputElement;
    inputValue = target.value;
  }

  async function handleBlur() {
    await saveSettings();
  }

  async function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter') {
      await saveSettings();
    }
  }

  async function saveSettings() {
    try {
      // Parse input: empty or 0 → 0 (auto), positive integer → cap
      const trimmed = inputValue.trim();
      let newValue: number;

      if (trimmed === '' || trimmed === '0') {
        newValue = 0;
      } else {
        const parsed = parseInt(trimmed, 10);
        if (isNaN(parsed) || parsed < 0) {
          // Invalid: reset to current value
          inputValue = maxConcurrent === 0 ? '' : String(maxConcurrent);
          return;
        }
        // Clamp to max 200 per daemon schema
        newValue = Math.min(parsed, 200);
      }

      // Only save if changed
      if (newValue !== maxConcurrent) {
        await appClient.settings.update([{ path: SETTING_PATH, value: newValue }]);
        maxConcurrent = newValue;
      }

      // Update display (normalize to empty for 0)
      inputValue = newValue === 0 ? '' : String(newValue);
      settingsError = '';
    } catch (error) {
      settingsError = m.settings_agentBackend_saveError();
      console.error('Failed to save agent settings:', error);
    }
  }

  const displayValue = $derived(
    maxConcurrent === 0 ? m.settings_agentBackend_autoValue() : formatInteger(maxConcurrent),
  );
</script>

<div class="space-y-4">
  {#if settingsError}
    <div class="text-xs text-destructive mb-2">
      {settingsError}
    </div>
  {/if}

  <!-- Max Concurrent Agents -->
  <div class="flex items-center justify-between gap-4">
    <div class="flex-1 min-w-0">
      <p class="text-sm font-medium text-foreground">{m.settings_agentBackend_maxConcurrent_label()}</p>
      <p class="text-xs text-subtle mt-0.5">
        {m.settings_agentBackend_maxConcurrent_description({ current: displayValue })}
      </p>
    </div>
    <div class="shrink-0 w-32">
      <Input
        type="number"
        bind:value={inputValue}
        oninput={handleInput}
        onblur={handleBlur}
        onkeydown={handleKeydown}
        placeholder={m.settings_agentBackend_autoPlaceholder()}
        min="0"
        max="200"
        step="1"
        class="h-9 text-sm"
      />
    </div>
  </div>

  <!-- Flush Queued Messages -->
  <div class="flex items-center justify-between gap-4">
    <div class="flex-1 min-w-0">
      <label for="flushQueuedMessages" class="text-sm font-medium text-foreground">
        {m.settings_agentBackend_flushQueuedMessages_label()}
      </label>
      <p class="text-xs text-subtle mt-0.5">
        {m.settings_agentBackend_flushQueuedMessages_description()}
      </p>
    </div>
    <div class="shrink-0 w-48">
      <Select.Root value={flushQueuedMessages} onchange={handleFlushModeChange}>
        <Select.Trigger id="flushQueuedMessages" class="py-1.5">
          <span class="truncate">{flushModeLabel}</span>
        </Select.Trigger>
        <Select.Content portal class="max-h-[300px] w-48">
          {#each flushModeOptions as option (option.value)}
            <Select.Item value={option.value}>
              <span class="truncate">{option.label}</span>
            </Select.Item>
          {/each}
        </Select.Content>
      </Select.Root>
    </div>
  </div>
</div>
