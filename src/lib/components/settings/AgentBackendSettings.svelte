<script lang="ts">
  /**
   * Agent Backend Settings Component
   *
   * Daemon-side agent configuration:
   * - agents.maxConcurrent: concurrent agent session cap
   * - agents.flushQueuedMessages: batch-deliver queued messages when a turn ends
   * - agents.memoryBudgetMb: aggregate child-tree memory admission gate (0 = off)
   * - agents.idleReapMinutes: idle-agent reap interval (0 = off)
   *
   * None of these take effect live — every row says so, matching the shipped
   * "Max concurrent agents" copy.
   */

  import { appClient } from '$lib/client';
  import { onMount } from 'svelte';
  import { m } from '$shared/paraglide/messages.js';
  import { formatInteger } from '$lib/i18n/format';
  import { Input } from '$lib/components/ui/input';
  import { Select } from '$lib/components/ui/select';
  import { Slider } from '$lib/components/ui/slider';
  import { Toggle } from '$lib/components/ui/toggle';
  import type { SettingDefinitionWithValue } from '$lib/client';

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
  const MEMORY_BUDGET_PATH = 'agents.memoryBudgetMb';
  const IDLE_REAP_PATH = 'agents.idleReapMinutes';

  // Slider granularity. The *range* is never hardcoded — it comes from the
  // catalog bound the daemon reports for `agents.memoryBudgetMb` (total physical
  // memory), which differs per machine. The step is 1 MB rather than a rounder
  // increment so the thumb sits on exactly the configured value: a coarser step
  // would make the browser snap a typed 1,500 MB to a neighbouring multiple and
  // show a number the setting does not hold. Fine adjustment is the field's job.
  const MEMORY_BUDGET_STEP_MB = 1;

  // Stepper range for the *enabled* reap interval. The catalog declares min 0
  // (0 being the documented disable value) and no maximum, so the enabled range
  // is a UI convention: 0 is reached through the toggle, never by stepping down
  // past 1, and the toggle is what labels the disabled state.
  const IDLE_REAP_MIN_MINUTES = 1;
  const IDLE_REAP_FALLBACK_MAX_MINUTES = 120;

  // Memory budget (MB). `committed` is the daemon-acknowledged value; `draft`
  // tracks the slider while dragging and is reset from `committed` whenever a
  // save fails, so a rejected write never leaves the control lying.
  let memoryBudgetSupported = $state(false);
  let memoryBudgetMb = $state(0);
  let memoryBudgetDraftMb = $state(0);
  let memoryBudgetInput = $state('0');
  let memoryBudgetMaxMb = $state<number | null>(null);
  // Whether the slider's ceiling is still the catalog's own bound. It is not
  // when a configured budget above that bound widened it, and the note naming
  // the maximum as this machine's total memory would then be false.
  let memoryBudgetMaxIsCatalogBound = $state(false);
  // Write bookkeeping — never rendered, so deliberately not reactive.
  // `target` is what the daemon will hold once in-flight writes settle;
  // `writing` + `queued` keep a single write in flight and coalesce whatever
  // the user does while it is outstanding.
  let memoryBudgetTargetMb = 0;
  let memoryBudgetWriting = false;
  let memoryBudgetQueuedMb: number | null = null;

  // Idle reap (minutes). `resumeMinutes` is what the toggle restores when it is
  // switched back on — the last non-zero value, or the daemon's own catalog
  // default. It is deliberately never a literal in this file.
  let idleReapSupported = $state(false);
  let idleReapMinutes = $state(0);
  let idleReapInput = $state('');
  // Bound to the toggle rather than derived from it: the Toggle owns its own
  // checked state once clicked, so a rejected write has to be pushed back into
  // it explicitly or the toggle would sit in a state the daemon never accepted.
  let idleReapToggleOn = $state(false);
  let idleReapMaxMinutes = $state(IDLE_REAP_FALLBACK_MAX_MINUTES);
  let idleReapResumeMinutes = $state(IDLE_REAP_MIN_MINUTES);
  // As above: in-flight write bookkeeping, not rendered.
  let idleReapTargetMinutes = 0;
  let idleReapWriting = false;
  let idleReapQueuedMinutes: number | null = null;

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
    // Use the documented single-path read in production. The list fallback
    // keeps compatibility with isolated component harnesses that predate
    // SettingsClient.get while still exercising the exact live wire contract.
    if (typeof appClient.settings.get === 'function') {
      const [maxConcurrentEntry, flushEntry, memoryBudgetEntry, idleReapEntry] = await Promise.all([
        appClient.settings.get(SETTING_PATH),
        appClient.settings.get(FLUSH_SETTING_PATH),
        appClient.settings.get(MEMORY_BUDGET_PATH),
        appClient.settings.get(IDLE_REAP_PATH),
      ]);
      if (!maxConcurrentEntry || !flushEntry) {
        settingsError = m.settings_agentBackend_loadError();
        return;
      }
      const value = typeof maxConcurrentEntry.value === 'number' ? maxConcurrentEntry.value : 0;
      maxConcurrent = value;
      inputValue = value === 0 ? '' : String(value);
      const flushValue = flushEntry.value;
      flushQueuedMessages = isFlushMode(flushValue)
        ? flushValue
        : flushValue === false
          ? 'off'
          : 'all';
      applyMemoryBudget(memoryBudgetEntry);
      applyIdleReap(idleReapEntry);
      settingsError = '';
      return;
    }

    const settings = await appClient.settings.list();
    if (settings.length === 0) {
      settingsError = m.settings_agentBackend_loadError();
      return;
    }

    settingsError = '';
    const byPath = new Map(settings.map((entry) => [entry.path, entry]));
    const value = byPath.get(SETTING_PATH)?.value;
    maxConcurrent = typeof value === 'number' ? value : 0;
    // Display empty for 0 (Auto)
    inputValue = maxConcurrent === 0 ? '' : String(maxConcurrent);
    // Legacy boolean values map to their nearest enum equivalent (`true` ->
    // `all`, `false` -> `off`); any other unknown/absent value falls back to
    // the daemon default of `all`.
    const flushValue = byPath.get(FLUSH_SETTING_PATH)?.value;
    if (isFlushMode(flushValue)) {
      flushQueuedMessages = flushValue;
    } else if (flushValue === false) {
      flushQueuedMessages = 'off';
    } else {
      flushQueuedMessages = 'all';
    }
    applyMemoryBudget(byPath.get(MEMORY_BUDGET_PATH));
    applyIdleReap(byPath.get(IDLE_REAP_PATH));
  }

  /**
   * Hydrate the memory budget row from the catalog entry. A daemon that does
   * not report the path (an older sidecar) hides the row rather than rendering
   * a control that writes to a setting it does not have; a daemon that reports
   * the path without an upper bound keeps the number field and drops the
   * slider, because the slider's maximum is the catalog's to supply.
   */
  function applyMemoryBudget(entry: SettingDefinitionWithValue | null | undefined) {
    if (!entry) {
      memoryBudgetSupported = false;
      return;
    }
    memoryBudgetSupported = true;
    const catalogMax = typeof entry.max === 'number' && entry.max > 0 ? entry.max : null;
    const value = typeof entry.value === 'number' && entry.value > 0 ? Math.round(entry.value) : 0;
    // The ceiling widens to admit what the daemon already holds, and never
    // narrows to hide it: the config file's own validation is looser than the
    // catalog bound, so a budget configured above it is a value the daemon
    // really has. Clamping on hydration would show a budget that is not set and
    // write that smaller number back on the next edit.
    memoryBudgetMaxMb = catalogMax === null ? null : Math.max(catalogMax, value);
    memoryBudgetMaxIsCatalogBound = catalogMax !== null && memoryBudgetMaxMb === catalogMax;
    memoryBudgetMb = value;
    memoryBudgetTargetMb = value;
    syncMemoryBudgetFromCommitted();
  }

  /** Hydrate the idle-reap row; an absent path hides it, as above. */
  function applyIdleReap(entry: SettingDefinitionWithValue | null | undefined) {
    if (!entry) {
      idleReapSupported = false;
      return;
    }
    idleReapSupported = true;
    const value = typeof entry.value === 'number' && entry.value > 0 ? Math.round(entry.value) : 0;
    const fallback =
      typeof entry.defaultValue === 'number' && entry.defaultValue > 0
        ? Math.round(entry.defaultValue)
        : 0;
    // Same rule as the budget, and it matters more here: the catalog declares
    // *no* maximum for this setting, so 1–120 is only a UI convention for
    // picking a value. A daemon configured at 240 minutes must read as 240 —
    // the convention widens to admit it rather than clamping a valid
    // daemon-owned interval down and writing the smaller value back.
    const catalogMax =
      typeof entry.max === 'number' && entry.max >= IDLE_REAP_MIN_MINUTES
        ? entry.max
        : IDLE_REAP_FALLBACK_MAX_MINUTES;
    idleReapMaxMinutes = Math.max(catalogMax, value, fallback);
    idleReapMinutes = value;
    idleReapTargetMinutes = value;
    // What the toggle restores: the configured interval when there is one,
    // otherwise the daemon's own catalog default. Never a literal — the shipped
    // default is the daemon's to choose.
    idleReapResumeMinutes =
      idleReapMinutes > 0 ? idleReapMinutes : fallback > 0 ? fallback : IDLE_REAP_MIN_MINUTES;
    syncIdleReapFromCommitted();
  }

  function clampMemoryBudget(value: number) {
    const rounded = Math.round(value);
    if (!Number.isFinite(rounded) || rounded < 0) return 0;
    return memoryBudgetMaxMb === null ? rounded : Math.min(rounded, memoryBudgetMaxMb);
  }

  function clampIdleReap(value: number) {
    const rounded = Math.round(value);
    if (!Number.isFinite(rounded)) return IDLE_REAP_MIN_MINUTES;
    return Math.min(Math.max(rounded, IDLE_REAP_MIN_MINUTES), idleReapMaxMinutes);
  }

  /** Reset the editable surfaces to the daemon-acknowledged budget. */
  function syncMemoryBudgetFromCommitted() {
    memoryBudgetDraftMb = memoryBudgetMb;
    memoryBudgetInput = String(memoryBudgetMb);
  }

  /**
   * Reset the stepper to the daemon-acknowledged interval. While reaping is
   * off the stepper is disabled and shows the value the toggle would restore,
   * because 0 is not a value the stepper itself can hold.
   */
  function syncIdleReapFromCommitted() {
    idleReapInput = String(idleReapMinutes > 0 ? idleReapMinutes : idleReapResumeMinutes);
    idleReapToggleOn = idleReapMinutes > 0;
  }

  async function saveMemoryBudget(next: number) {
    const clamped = clampMemoryBudget(next);
    // Compare against the value the daemon will hold once in-flight writes
    // settle, not the last acknowledgement: while a write is outstanding
    // `memoryBudgetMb` is still the old value, so going 100 → 200 → 100 would
    // read the second 100 as a no-op, skip it, and leave the daemon on 200.
    // The slider reaches this easily — one release per drag.
    if (clamped === memoryBudgetTargetMb) {
      if (!memoryBudgetWriting) syncMemoryBudgetFromCommitted();
      return;
    }
    memoryBudgetTargetMb = clamped;
    // Only one write per path may be in flight. Tagging responses would not be
    // enough: the transport allows concurrent requests and the daemon may apply
    // them in either order, so overlapping writes could persist the older value
    // while this UI reports the newer one. Later intents coalesce here and are
    // sent once the current write resolves, which also makes a stale response
    // impossible rather than merely ignored.
    if (memoryBudgetWriting) {
      memoryBudgetQueuedMb = clamped;
      return;
    }
    memoryBudgetWriting = true;
    try {
      let value: number | null = clamped;
      while (value !== null) {
        // Captured before the await so the response can tell whether the user
        // has moved on from what was sent.
        const sentInput = memoryBudgetInput;
        const sentDraft = memoryBudgetDraftMb;
        const applied = await appClient.settings.update([{ path: MEMORY_BUDGET_PATH, value }]);
        const entry = applied.find((change) => change.path === MEMORY_BUDGET_PATH);
        if (!entry || typeof entry.value !== 'number') {
          settingsError = m.settings_agentBackend_saveError();
          memoryBudgetQueuedMb = null;
          memoryBudgetTargetMb = memoryBudgetMb;
          syncMemoryBudgetFromCommitted();
          return;
        }
        memoryBudgetMb = entry.value;
        settingsError = '';
        value = memoryBudgetQueuedMb;
        memoryBudgetQueuedMb = null;
        if (value === null) {
          // Settled. Normalise only the surfaces the user has not touched since
          // the write went out — a response landing mid-edit must not rewrite
          // the number being typed or the slider being dragged.
          if (memoryBudgetInput === sentInput) memoryBudgetInput = String(memoryBudgetMb);
          if (memoryBudgetDraftMb === sentDraft) memoryBudgetDraftMb = memoryBudgetMb;
        }
      }
    } catch (error) {
      settingsError = m.settings_agentBackend_saveError();
      memoryBudgetQueuedMb = null;
      memoryBudgetTargetMb = memoryBudgetMb;
      syncMemoryBudgetFromCommitted();
      console.error('Failed to save agent settings:', error);
    } finally {
      memoryBudgetWriting = false;
    }
  }

  function handleMemoryBudgetSlide(value: number) {
    memoryBudgetDraftMb = clampMemoryBudget(value);
    memoryBudgetInput = String(memoryBudgetDraftMb);
  }

  async function handleMemoryBudgetSlideCommit() {
    await saveMemoryBudget(memoryBudgetDraftMb);
  }

  function handleMemoryBudgetInput(event: Event) {
    memoryBudgetInput = (event.target as HTMLInputElement).value;
  }

  async function commitMemoryBudgetInput() {
    const trimmed = memoryBudgetInput.trim();
    const parsed = trimmed === '' ? 0 : Number(trimmed);
    if (!Number.isFinite(parsed) || parsed < 0) {
      // Invalid: restore the committed value rather than guessing at intent.
      syncMemoryBudgetFromCommitted();
      return;
    }
    await saveMemoryBudget(parsed);
  }

  async function handleMemoryBudgetKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter') await commitMemoryBudgetInput();
  }

  async function saveIdleReap(next: number) {
    const value = next <= 0 ? 0 : clampIdleReap(next);
    // Same in-flight rule as the budget, and the toggle reaches it fastest:
    // off → on → off in quick succession would otherwise read the third click
    // as a no-op and leave reaping enabled.
    if (value === idleReapTargetMinutes) {
      if (!idleReapWriting) syncIdleReapFromCommitted();
      return;
    }
    idleReapTargetMinutes = value;
    // Serialized and coalesced exactly like the budget, and for the same
    // reason — see saveMemoryBudget.
    if (idleReapWriting) {
      idleReapQueuedMinutes = value;
      return;
    }
    idleReapWriting = true;
    try {
      let next: number | null = value;
      while (next !== null) {
        const sentInput = idleReapInput;
        const applied = await appClient.settings.update([{ path: IDLE_REAP_PATH, value: next }]);
        const entry = applied.find((change) => change.path === IDLE_REAP_PATH);
        if (!entry || typeof entry.value !== 'number') {
          settingsError = m.settings_agentBackend_saveError();
          idleReapQueuedMinutes = null;
          idleReapTargetMinutes = idleReapMinutes;
          syncIdleReapFromCommitted();
          return;
        }
        idleReapMinutes = entry.value > 0 ? entry.value : 0;
        if (idleReapMinutes > 0) idleReapResumeMinutes = idleReapMinutes;
        settingsError = '';
        next = idleReapQueuedMinutes;
        idleReapQueuedMinutes = null;
        if (next === null) {
          // The toggle always follows the settled value — it has no in-progress
          // state to protect — but the stepper text is left alone if the user
          // has typed something newer since the write went out.
          idleReapToggleOn = idleReapMinutes > 0;
          if (idleReapInput === sentInput) {
            idleReapInput = String(idleReapMinutes > 0 ? idleReapMinutes : idleReapResumeMinutes);
          }
        }
      }
    } catch (error) {
      settingsError = m.settings_agentBackend_saveError();
      idleReapQueuedMinutes = null;
      idleReapTargetMinutes = idleReapMinutes;
      syncIdleReapFromCommitted();
      console.error('Failed to save agent settings:', error);
    } finally {
      idleReapWriting = false;
    }
  }

  async function handleIdleReapToggle(checked: boolean) {
    await saveIdleReap(checked ? idleReapResumeMinutes : 0);
  }

  function handleIdleReapInput(event: Event) {
    idleReapInput = (event.target as HTMLInputElement).value;
  }

  async function commitIdleReapInput() {
    const parsed = Number(idleReapInput.trim());
    if (!Number.isFinite(parsed) || idleReapInput.trim() === '') {
      syncIdleReapFromCommitted();
      return;
    }
    // The stepper cannot express "off" — that is the toggle's job — so a 0 or
    // negative entry is clamped up to the minimum rather than silently
    // disabling reaping.
    await saveIdleReap(clampIdleReap(parsed));
  }

  async function handleIdleReapKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter') await commitIdleReapInput();
  }

  async function handleFlushModeChange(value: string) {
    if (!isFlushMode(value) || value === flushQueuedMessages) return;
    try {
      const applied = await appClient.settings.update([{ path: FLUSH_SETTING_PATH, value }]);
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

  /** 0 reads as "off" — never as a zero-byte budget that would refuse every spawn. */
  function formatMemoryBudget(valueMb: number) {
    return valueMb === 0
      ? m.settings_agentBackend_memoryBudget_offValue()
      : m.settings_agentBackend_memoryBudget_megabytesValue({ value: formatInteger(valueMb) });
  }

  /** The live slider/field value, which is not yet saved while it is being dragged. */
  const memoryBudgetDraftDisplay = $derived(formatMemoryBudget(memoryBudgetDraftMb));

  /** The daemon-acknowledged value, which is what "Current:" may claim. */
  const memoryBudgetDisplay = $derived(formatMemoryBudget(memoryBudgetMb));

  // Shown only while the ceiling is the catalog's own bound; once a configured
  // budget has widened it past total memory the sentence would not be true.
  const memoryBudgetMaxDisplay = $derived(
    memoryBudgetMaxMb === null || !memoryBudgetMaxIsCatalogBound
      ? ''
      : m.settings_agentBackend_memoryBudget_megabytesValue({
          value: formatInteger(memoryBudgetMaxMb),
        }),
  );

  const idleReapEnabled = $derived(idleReapMinutes > 0);

  /** 0 reads as "off" — the documented disable value, not a 0-minute interval. */
  const idleReapDisplay = $derived(
    idleReapEnabled
      ? m.settings_agentBackend_idleReap_minutesValue({ value: formatInteger(idleReapMinutes) })
      : m.settings_agentBackend_idleReap_offValue(),
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
      <p class="text-sm font-medium text-foreground">
        {m.settings_agentBackend_maxConcurrent_label()}
      </p>
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

  <!-- Agent memory budget (hidden when the daemon does not report the path) -->
  {#if memoryBudgetSupported}
    <div class="flex items-start justify-between gap-4">
      <div class="flex-1 min-w-0">
        <label for="memoryBudgetMb" class="text-sm font-medium text-foreground">
          {m.settings_agentBackend_memoryBudget_label()}
        </label>
        <p class="text-xs text-subtle mt-0.5">
          {m.settings_agentBackend_memoryBudget_description({ current: memoryBudgetDisplay })}
        </p>
        {#if memoryBudgetMaxDisplay}
          <p class="text-xs text-subtle mt-0.5">
            {m.settings_agentBackend_memoryBudget_boundsNote({ max: memoryBudgetMaxDisplay })}
          </p>
        {/if}
      </div>
      <div class="shrink-0 w-56 flex flex-col gap-2">
        {#if memoryBudgetMaxMb !== null}
          <Slider
            value={memoryBudgetDraftMb}
            min={0}
            max={memoryBudgetMaxMb}
            step={MEMORY_BUDGET_STEP_MB}
            onValueChange={handleMemoryBudgetSlide}
            onchange={handleMemoryBudgetSlideCommit}
            aria-label={m.settings_agentBackend_memoryBudget_sliderLabel()}
            aria-valuetext={memoryBudgetDraftDisplay}
          />
        {/if}
        <div class="flex items-center gap-2">
          <Input
            id="memoryBudgetMb"
            type="number"
            bind:value={memoryBudgetInput}
            oninput={handleMemoryBudgetInput}
            onblur={commitMemoryBudgetInput}
            onkeydown={handleMemoryBudgetKeydown}
            min="0"
            max={memoryBudgetMaxMb === null ? undefined : String(memoryBudgetMaxMb)}
            step="1"
            class="h-9 text-sm"
          />
          <span class="text-xs text-subtle shrink-0">{memoryBudgetDraftDisplay}</span>
        </div>
      </div>
    </div>
  {/if}

  <!-- Idle reap minutes (hidden when the daemon does not report the path) -->
  {#if idleReapSupported}
    <div class="flex items-start justify-between gap-4">
      <div class="flex-1 min-w-0">
        <p class="text-sm font-medium text-foreground">
          {m.settings_agentBackend_idleReap_label()}
        </p>
        <p class="text-xs text-subtle mt-0.5">
          {m.settings_agentBackend_idleReap_description({ current: idleReapDisplay })}
        </p>
        <p class="text-xs text-subtle mt-0.5">
          {m.settings_agentBackend_idleReap_boundsNote({
            min: formatInteger(IDLE_REAP_MIN_MINUTES),
            max: formatInteger(idleReapMaxMinutes),
          })}
        </p>
      </div>
      <div class="shrink-0 w-56 flex items-center justify-end gap-3">
        <span class="text-xs text-subtle">
          {m.settings_agentBackend_idleReap_toggleLabel()}
        </span>
        <Toggle
          bind:pressed={idleReapToggleOn}
          onChange={(pressed) => handleIdleReapToggle(pressed === true)}
          size="xs"
          ariaLabel={m.settings_agentBackend_idleReap_toggleLabel()}
        />
        <!--
          The stepper follows the toggle, not the last daemon acknowledgement:
          while a disable is in flight the daemon still reports the old
          interval, and a stepper left live in that window would let an edit
          queue a positive write behind the 0 and quietly undo the switch-off.
        -->
        <div class="w-24">
          <Input
            id="idleReapMinutes"
            type="number"
            bind:value={idleReapInput}
            oninput={handleIdleReapInput}
            onblur={commitIdleReapInput}
            onkeydown={handleIdleReapKeydown}
            disabled={!idleReapToggleOn}
            aria-label={m.settings_agentBackend_idleReap_stepperLabel()}
            min={String(IDLE_REAP_MIN_MINUTES)}
            max={String(idleReapMaxMinutes)}
            step="1"
            class="h-9 text-sm"
          />
        </div>
      </div>
    </div>
  {/if}
</div>
