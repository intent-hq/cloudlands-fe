<script lang="ts">
  /**
   * Agent Backend Settings Component
   *
   * Daemon-side agent configuration:
   * - agents.maxConcurrent: concurrent agent session cap
   * - agents.flushQueuedMessages: batch-deliver queued messages when a turn ends
   * - agents.memoryBudgetMb: aggregate child-tree memory admission gate
   *   (absent = auto, a host-derived budget the catalog advertises as
   *   defaultValue; 0 = off)
   * - agents.idleReapMinutes: idle-agent reap interval (0 = off)
   * - agents.acpNodeMaxOldSpaceMb: V8 heap cap for Node/Electron ACP processes
   *
   * The heap cap is read at spawn time and applies to newly started agent
   * processes; the rest take effect on daemon restart. Every row says which,
   * matching the shipped "Max concurrent agents" copy.
   */

  import { onMount } from 'svelte';
  import { store as appStore } from '$store/renderer/store';
  import {
    settingsFormOpened,
    settingsFormClosed,
    settingsFormLoadRequested,
    settingsFormSaveRequested,
    settingsFormDraftChanged,
  } from '$store/renderer/slices/settings-events/settings-events-slice';
  import {
    selectSettingsForm,
    selectSettingsFormEntries,
    selectSettingsFormError,
    selectSettingsFormOperation,
  } from '$store/renderer/slices/settings-events/settings-events-selectors';
  import type { SettingsFormIdentity } from '$store/renderer/slices/settings-events/settings-events-types';
  import { m } from '$shared/paraglide/messages.js';
  import { formatInteger } from '$lib/i18n/format';
  import {
    SettingsForm,
    defineSettings,
    defineSettingsCustomControls,
    type SettingsControlContext,
  } from '$lib/components/patterns/settings';
  import { Input, Select, Slider, Switch } from '$lib/components/patterns/settings/custom-controls';

  type FlushQueuedMessagesMode = 'all' | 'systemOnly' | 'off';

  const FLUSH_MODES: FlushQueuedMessagesMode[] = ['all', 'systemOnly', 'off'];

  function isFlushMode(value: unknown): value is FlushQueuedMessagesMode {
    return typeof value === 'string' && (FLUSH_MODES as string[]).includes(value);
  }

  const SETTING_PATH = 'agents.maxConcurrent';
  const FLUSH_SETTING_PATH = 'agents.flushQueuedMessages';
  const MEMORY_BUDGET_PATH = 'agents.memoryBudgetMb';
  const IDLE_REAP_PATH = 'agents.idleReapMinutes';
  const ACP_HEAP_PATH = 'agents.acpNodeMaxOldSpaceMb';

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

  // Heap-cap bounds used only when the catalog entry omits them; the daemon's
  // own definition (min/max/defaultValue) is authoritative when present.
  const ACP_HEAP_FALLBACK_MIN_MB = 1024;
  const ACP_HEAP_FALLBACK_MAX_MB = 65536;
  const ACP_HEAP_FALLBACK_DEFAULT_MB = 8192;

  const identity: SettingsFormIdentity = {
    formId: crypto.randomUUID(),
    sessionId: crypto.randomUUID(),
  };
  const form$ = selectSettingsForm(identity);
  const entries$ = selectSettingsFormEntries(identity);
  const error$ = selectSettingsFormError(identity);
  const settingsError = $derived($error$);
  const maxConcurrent = $derived(
    typeof $entries$[SETTING_PATH]?.value === 'number' ? $entries$[SETTING_PATH].value : 0,
  );
  let inputValue = $derived(
    String($form$?.drafts[SETTING_PATH] ?? (maxConcurrent === 0 ? '' : maxConcurrent)),
  );
  const flushValue = $derived($entries$[FLUSH_SETTING_PATH]?.value);
  const flushQueuedMessages = $derived(
    isFlushMode(flushValue) ? flushValue : flushValue === false ? 'off' : 'all',
  );

  const memoryBudgetEntry = $derived($entries$[MEMORY_BUDGET_PATH]);
  const memoryBudgetSupported = $derived(memoryBudgetEntry !== undefined);
  const memoryBudgetAuto = $derived(
    memoryBudgetEntry?.value == null && positiveNumber(memoryBudgetEntry?.defaultValue, 0) > 0,
  );
  const memoryBudgetMb = $derived(
    positiveNumber(
      memoryBudgetAuto ? memoryBudgetEntry?.defaultValue : memoryBudgetEntry?.value,
      0,
    ),
  );
  const memoryBudgetCatalogMax = $derived(positiveNumber(memoryBudgetEntry?.max, 0));
  const memoryBudgetLoadedMb = $derived(
    positiveNumber($form$?.values[`${MEMORY_BUDGET_PATH}:loadedValue`], 0),
  );
  const memoryBudgetMaxMb = $derived(
    memoryBudgetCatalogMax > 0 ? Math.max(memoryBudgetCatalogMax, memoryBudgetLoadedMb) : null,
  );
  const memoryBudgetMaxIsCatalogBound = $derived(memoryBudgetMaxMb === memoryBudgetCatalogMax);
  let memoryBudgetInput = $derived(String($form$?.drafts[MEMORY_BUDGET_PATH] ?? memoryBudgetMb));
  let memoryBudgetDraftMb = $derived(
    Number($form$?.drafts[`${MEMORY_BUDGET_PATH}:slider`] ?? memoryBudgetMb),
  );

  const idleReapEntry = $derived($entries$[IDLE_REAP_PATH]);
  const idleReapSupported = $derived(idleReapEntry !== undefined);
  const idleReapMinutes = $derived(positiveNumber(idleReapEntry?.value, 0));
  const idleReapResumeMinutes = $derived(
    positiveNumber(
      $form$?.values.idleReapResumeMinutes,
      positiveNumber(
        idleReapMinutes,
        positiveNumber(idleReapEntry?.defaultValue, IDLE_REAP_MIN_MINUTES),
      ),
    ),
  );
  const idleReapMaxMinutes = $derived(
    Math.max(
      positiveNumber(idleReapEntry?.max, IDLE_REAP_FALLBACK_MAX_MINUTES),
      positiveNumber($form$?.values[`${IDLE_REAP_PATH}:loadedValue`], 0),
      positiveNumber(idleReapEntry?.defaultValue, 0),
    ),
  );
  let idleReapInput = $derived(
    String(
      $form$?.drafts[IDLE_REAP_PATH] ??
        (idleReapMinutes > 0 ? idleReapMinutes : idleReapResumeMinutes),
    ),
  );
  const idleReapOperation$ = selectSettingsFormOperation(identity, IDLE_REAP_PATH);
  let idleReapToggleOn = $derived(
    $idleReapOperation$?.status === 'pending'
      ? Number($idleReapOperation$.submittedDrafts?.[IDLE_REAP_PATH] ?? idleReapMinutes) > 0
      : idleReapMinutes > 0,
  );

  const acpHeapEntry = $derived($entries$[ACP_HEAP_PATH]);
  const acpHeapSupported = $derived(acpHeapEntry !== undefined);
  const acpHeapDefaultMb = $derived(
    positiveNumber(acpHeapEntry?.defaultValue, ACP_HEAP_FALLBACK_DEFAULT_MB),
  );
  const acpHeapMb = $derived(positiveNumber(acpHeapEntry?.value, acpHeapDefaultMb));
  const acpHeapLoadedMb = $derived(
    positiveNumber($form$?.values[`${ACP_HEAP_PATH}:loadedValue`], acpHeapDefaultMb),
  );
  const acpHeapMinMb = $derived(
    Math.min(positiveNumber(acpHeapEntry?.min, ACP_HEAP_FALLBACK_MIN_MB), acpHeapLoadedMb),
  );
  const acpHeapMaxMb = $derived(
    Math.max(positiveNumber(acpHeapEntry?.max, ACP_HEAP_FALLBACK_MAX_MB), acpHeapLoadedMb),
  );
  let acpHeapInput = $derived(String($form$?.drafts[ACP_HEAP_PATH] ?? acpHeapMb));

  function positiveNumber(value: unknown, fallback: number): number {
    return typeof value === 'number' && value > 0 ? Math.round(value) : fallback;
  }

  const flushModeOptions = $derived([
    { value: 'all', label: m.settings_agentBackend_flushQueuedMessages_all_label() },
    { value: 'systemOnly', label: m.settings_agentBackend_flushQueuedMessages_systemOnly_label() },
    { value: 'off', label: m.settings_agentBackend_flushQueuedMessages_off_label() },
  ]);

  const flushModeLabel = $derived(
    flushModeOptions.find((option) => option.value === flushQueuedMessages)?.label ??
      flushQueuedMessages,
  );

  onMount(() => {
    appStore.dispatch(settingsFormOpened(identity, 'agent-backend'));
    appStore.dispatch(
      settingsFormLoadRequested({ ...identity, requestId: crypto.randomUUID(), resource: 'load' }),
    );
    return () => appStore.dispatch(settingsFormClosed(identity));
  });

  function clampMemoryBudget(value: number) {
    const rounded = Math.round(value);
    if (!Number.isFinite(rounded) || rounded < 0) return 0;
    return memoryBudgetMaxMb === null ? rounded : Math.min(rounded, memoryBudgetMaxMb);
  }

  function clampAcpHeap(value: number) {
    const rounded = Math.round(value);
    if (!Number.isFinite(rounded)) return acpHeapMb;
    return Math.min(Math.max(rounded, acpHeapMinMb), acpHeapMaxMb);
  }

  function clampIdleReap(value: number) {
    const rounded = Math.round(value);
    if (!Number.isFinite(rounded)) return IDLE_REAP_MIN_MINUTES;
    return Math.min(Math.max(rounded, IDLE_REAP_MIN_MINUTES), idleReapMaxMinutes);
  }

  function currentNumber(path: string) {
    const entry = selectSettingsFormEntries.select(appStore.state, identity)[path];
    const fallback =
      path === ACP_HEAP_PATH
        ? positiveNumber(entry?.defaultValue, ACP_HEAP_FALLBACK_DEFAULT_MB)
        : path === MEMORY_BUDGET_PATH && entry?.value == null
          ? positiveNumber(entry?.defaultValue, 0)
          : 0;
    return positiveNumber(entry?.value, fallback);
  }

  function saveNumber(path: string, value: number) {
    const operation = selectSettingsFormOperation.select(appStore.state, identity, path);
    if (value === currentNumber(path) && operation?.status !== 'pending') {
      appStore.dispatch(settingsFormDraftChanged(identity, path, String(value)));
      if (path === MEMORY_BUDGET_PATH) {
        appStore.dispatch(settingsFormDraftChanged(identity, `${path}:slider`, value));
      }
      return;
    }
    appStore.dispatch(
      settingsFormSaveRequested({ ...identity, resource: path, requestId: crypto.randomUUID() }, [
        { path, value },
      ]),
    );
  }

  function handleMemoryBudgetSlide(value: number) {
    const clamped = clampMemoryBudget(value);
    appStore.dispatch(settingsFormDraftChanged(identity, MEMORY_BUDGET_PATH, String(clamped)));
    appStore.dispatch(settingsFormDraftChanged(identity, `${MEMORY_BUDGET_PATH}:slider`, clamped));
  }

  function handleMemoryBudgetSlideCommit() {
    const form = selectSettingsForm.select(appStore.state, identity);
    saveNumber(
      MEMORY_BUDGET_PATH,
      Number(form?.drafts[`${MEMORY_BUDGET_PATH}:slider`] ?? currentNumber(MEMORY_BUDGET_PATH)),
    );
  }

  function handleMemoryBudgetInput(event: Event) {
    appStore.dispatch(
      settingsFormDraftChanged(
        identity,
        MEMORY_BUDGET_PATH,
        (event.target as HTMLInputElement).value,
      ),
    );
  }

  function commitMemoryBudgetInput() {
    const form = selectSettingsForm.select(appStore.state, identity);
    const committed = currentNumber(MEMORY_BUDGET_PATH);
    const trimmed = String(form?.drafts[MEMORY_BUDGET_PATH] ?? committed).trim();
    const parsed = trimmed === '' ? 0 : Number(trimmed);
    if (!Number.isFinite(parsed) || parsed < 0) {
      // Invalid: restore the committed value rather than guessing at intent.
      appStore.dispatch(settingsFormDraftChanged(identity, MEMORY_BUDGET_PATH, String(committed)));
      appStore.dispatch(
        settingsFormDraftChanged(identity, `${MEMORY_BUDGET_PATH}:slider`, committed),
      );
      return;
    }
    saveNumber(MEMORY_BUDGET_PATH, clampMemoryBudget(parsed));
  }

  function handleMemoryBudgetKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter') commitMemoryBudgetInput();
  }
  function handleIdleReapToggle(checked: boolean) {
    idleReapToggleOn = checked;
    const form = selectSettingsForm.select(appStore.state, identity);
    const resume = positiveNumber(form?.values.idleReapResumeMinutes, idleReapResumeMinutes);
    const value = checked ? clampIdleReap(resume) : 0;
    appStore.dispatch(settingsFormDraftChanged(identity, IDLE_REAP_PATH, String(value)));
    saveNumber(IDLE_REAP_PATH, value);
  }

  function handleIdleReapInput(event: Event) {
    appStore.dispatch(
      settingsFormDraftChanged(identity, IDLE_REAP_PATH, (event.target as HTMLInputElement).value),
    );
  }

  function commitIdleReapInput() {
    const form = selectSettingsForm.select(appStore.state, identity);
    const trimmed = String(form?.drafts[IDLE_REAP_PATH] ?? idleReapInput).trim();
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed) || trimmed === '') {
      appStore.dispatch(
        settingsFormDraftChanged(
          identity,
          IDLE_REAP_PATH,
          String(idleReapMinutes > 0 ? idleReapMinutes : idleReapResumeMinutes),
        ),
      );
      return;
    }
    // The stepper cannot express "off" — that is the toggle's job — so a 0 or
    // negative entry is clamped up to the minimum rather than silently
    // disabling reaping.
    saveNumber(IDLE_REAP_PATH, clampIdleReap(parsed));
  }

  function handleIdleReapKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter') commitIdleReapInput();
  }

  function handleAcpHeapInput(event: Event) {
    appStore.dispatch(
      settingsFormDraftChanged(identity, ACP_HEAP_PATH, (event.target as HTMLInputElement).value),
    );
  }

  function commitAcpHeapInput() {
    const form = selectSettingsForm.select(appStore.state, identity);
    const committed = currentNumber(ACP_HEAP_PATH);
    const trimmed = String(form?.drafts[ACP_HEAP_PATH] ?? committed).trim();
    const parsed = Number(trimmed);
    if (trimmed === '' || !Number.isFinite(parsed)) {
      // Invalid: restore the committed value rather than guessing at intent.
      appStore.dispatch(settingsFormDraftChanged(identity, ACP_HEAP_PATH, String(committed)));
      return;
    }
    saveNumber(ACP_HEAP_PATH, clampAcpHeap(parsed));
  }

  function handleAcpHeapKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter') commitAcpHeapInput();
  }
  function handleFlushModeChange(value: string) {
    const operation = selectSettingsFormOperation.select(
      appStore.state,
      identity,
      FLUSH_SETTING_PATH,
    );
    const entry = selectSettingsFormEntries.select(appStore.state, identity)[FLUSH_SETTING_PATH];
    const committed = isFlushMode(entry?.value)
      ? entry.value
      : entry?.value === false
        ? 'off'
        : 'all';
    if (!isFlushMode(value) || (value === committed && operation?.status !== 'pending')) return;
    appStore.dispatch(
      settingsFormSaveRequested(
        { ...identity, resource: FLUSH_SETTING_PATH, requestId: crypto.randomUUID() },
        [{ path: FLUSH_SETTING_PATH, value }],
      ),
    );
  }

  function handleInput(event: Event) {
    const target = event.target as HTMLInputElement;
    appStore.dispatch(settingsFormDraftChanged(identity, SETTING_PATH, target.value));
  }

  function handleBlur() {
    saveSettings();
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter') {
      saveSettings();
    }
  }

  function saveSettings() {
    const form = selectSettingsForm.select(appStore.state, identity);
    const committed = currentNumber(SETTING_PATH);
    const trimmed = String(form?.drafts[SETTING_PATH] ?? inputValue).trim();
    const parsed = trimmed === '' ? 0 : parseInt(trimmed, 10);
    if (isNaN(parsed) || parsed < 0) {
      appStore.dispatch(
        settingsFormDraftChanged(identity, SETTING_PATH, committed === 0 ? '' : String(committed)),
      );
      return;
    }
    const value = Math.min(parsed, 200);
    saveNumber(SETTING_PATH, value);
    if (value === 0) appStore.dispatch(settingsFormDraftChanged(identity, SETTING_PATH, ''));
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

  /**
   * The absent key reads as "Auto (N MB)" — the host-derived budget the daemon
   * is enforcing — never as a bare N the user did not persist.
   */
  function formatCommittedMemoryBudget() {
    return memoryBudgetAuto
      ? m.settings_agentBackend_memoryBudget_autoValue({ value: formatInteger(memoryBudgetMb) })
      : formatMemoryBudget(memoryBudgetMb);
  }

  /** The live slider/field value, which is not yet saved while it is being dragged. */
  const memoryBudgetDraftDisplay = $derived(
    memoryBudgetDraftMb === memoryBudgetMb
      ? formatCommittedMemoryBudget()
      : formatMemoryBudget(memoryBudgetDraftMb),
  );

  /** The daemon-acknowledged value, which is what "Current:" may claim. */
  const memoryBudgetDisplay = $derived(formatCommittedMemoryBudget());

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

  function formatAcpHeap(valueMb: number) {
    return m.settings_agentBackend_acpHeap_megabytesValue({ value: formatInteger(valueMb) });
  }

  /** The effective cap: the daemon-acknowledged value, or the catalog default while unset. */
  const acpHeapDisplay = $derived(formatAcpHeap(acpHeapMb));

  /** 0 reads as "off" — the documented disable value, not a 0-minute interval. */
  const idleReapDisplay = $derived(
    idleReapEnabled
      ? m.settings_agentBackend_idleReap_minutesValue({ value: formatInteger(idleReapMinutes) })
      : m.settings_agentBackend_idleReap_offValue(),
  );

  const schema = $derived.by(() =>
    defineSettings({
      sections: [
        {
          id: 'agent-backend',
          title: m.settings_section_agentBackend(),
          entries: [
            {
              kind: 'custom',
              id: 'max-concurrent-agents',
              label: m.settings_agentBackend_maxConcurrent_label(),
              description: m.settings_agentBackend_maxConcurrent_description({
                current: displayValue,
              }),
            },
            {
              kind: 'custom',
              id: 'flush-queued-messages',
              label: m.settings_agentBackend_flushQueuedMessages_label(),
              description: m.settings_agentBackend_flushQueuedMessages_description(),
            },
            {
              kind: 'custom',
              id: 'memory-budget',
              label: m.settings_agentBackend_memoryBudget_label(),
              when: () => memoryBudgetSupported,
            },
            {
              kind: 'custom',
              id: 'idle-reap',
              label: m.settings_agentBackend_idleReap_toggleLabel(),
              when: () => idleReapSupported,
            },
            {
              kind: 'custom',
              id: 'idle-reap-minutes-row',
              label: m.settings_agentBackend_idleReap_label(),
              description: m.settings_agentBackend_idleReap_boundsNote({
                min: formatInteger(IDLE_REAP_MIN_MINUTES),
                max: formatInteger(idleReapMaxMinutes),
              }),
              when: () => idleReapSupported && idleReapToggleOn,
              class: 'ml-3',
            },
            {
              kind: 'custom',
              id: 'acp-node-heap',
              label: m.settings_agentBackend_acpHeap_label(),
              when: () => acpHeapSupported,
            },
          ],
        },
      ],
    }),
  );
</script>

{#snippet memoryBudgetDescription()}
  {m.settings_agentBackend_memoryBudget_description({ current: memoryBudgetDisplay })}
  {#if memoryBudgetMaxDisplay}
    {m.settings_agentBackend_memoryBudget_boundsNote({ max: memoryBudgetMaxDisplay })}
  {/if}
{/snippet}

{#snippet idleReapDescription()}
  {m.settings_agentBackend_idleReap_description({ current: idleReapDisplay })}
  {m.settings_agentBackend_idleReap_offNote()}
{/snippet}

{#snippet acpHeapDescription()}
  {m.settings_agentBackend_acpHeap_description({ current: acpHeapDisplay })}
  {m.settings_agentBackend_acpHeap_boundsNote({
    min: formatAcpHeap(acpHeapMinMb),
    max: formatAcpHeap(acpHeapMaxMb),
    defaultValue: formatAcpHeap(acpHeapDefaultMb),
  })}
{/snippet}

{#snippet maxConcurrentControl({ labelId, descriptionId }: SettingsControlContext)}
  <Input
    id="maxConcurrentAgents"
    type="number"
    bind:value={inputValue}
    oninput={handleInput}
    onblur={handleBlur}
    onkeydown={handleKeydown}
    placeholder={m.settings_agentBackend_autoPlaceholder()}
    min="0"
    max="200"
    step="1"
    aria-labelledby={labelId}
    aria-describedby={descriptionId}
    class="w-32"
  />
{/snippet}

{#snippet flushQueuedMessagesControl({ labelId, descriptionId }: SettingsControlContext)}
  <div class="w-32">
    <Select.Root value={flushQueuedMessages} onchange={handleFlushModeChange}>
      <Select.Trigger
        id="flushQueuedMessages"
        aria-labelledby={labelId}
        aria-describedby={descriptionId}
      >
        <span class="truncate">{flushModeLabel}</span>
      </Select.Trigger>
      <Select.Content portal class="max-h-[300px] w-32">
        {#each flushModeOptions as option (option.value)}
          <Select.Item value={option.value}>
            <span class="truncate">{option.label}</span>
          </Select.Item>
        {/each}
      </Select.Content>
    </Select.Root>
  </div>
{/snippet}

{#snippet memoryBudgetControl({ labelId, descriptionId }: SettingsControlContext)}
  <div class="flex w-32 flex-col gap-2">
    {#if memoryBudgetMaxMb !== null}
      <Slider
        bind:value={memoryBudgetDraftMb}
        min={0}
        max={memoryBudgetMaxMb}
        step={MEMORY_BUDGET_STEP_MB}
        onValueChange={handleMemoryBudgetSlide}
        onchange={handleMemoryBudgetSlideCommit}
        aria-label={m.settings_agentBackend_memoryBudget_sliderLabel()}
        aria-describedby={descriptionId}
        aria-valuetext={memoryBudgetDraftDisplay}
      />
    {/if}
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
      aria-labelledby={labelId}
      aria-describedby={descriptionId}
      class="w-32"
    />
  </div>
{/snippet}

{#snippet idleReapControl({ labelId, descriptionId }: SettingsControlContext)}
  <Switch
    id="idleReapToggle"
    bind:checked={idleReapToggleOn}
    onCheckedChange={handleIdleReapToggle}
    size="sm"
    ariaLabelledby={labelId}
    ariaDescribedby={descriptionId}
  />
{/snippet}

{#snippet idleReapMinutesControl({ labelId, descriptionId }: SettingsControlContext)}
  <Input
    id="idleReapMinutes"
    type="number"
    bind:value={idleReapInput}
    oninput={handleIdleReapInput}
    onblur={commitIdleReapInput}
    onkeydown={handleIdleReapKeydown}
    min={String(IDLE_REAP_MIN_MINUTES)}
    max={String(idleReapMaxMinutes)}
    step="1"
    aria-labelledby={labelId}
    aria-describedby={descriptionId}
    class="w-32"
  />
{/snippet}

{#snippet acpHeapControl({ labelId, descriptionId }: SettingsControlContext)}
  <Input
    id="acpNodeMaxOldSpaceMb"
    type="number"
    bind:value={acpHeapInput}
    oninput={handleAcpHeapInput}
    onblur={commitAcpHeapInput}
    onkeydown={handleAcpHeapKeydown}
    min={String(acpHeapMinMb)}
    max={String(acpHeapMaxMb)}
    step="1"
    aria-labelledby={labelId}
    aria-describedby={descriptionId}
    class="w-32"
  />
{/snippet}

{#if settingsError}
  <div class="type-body mb-2 text-danger" role="alert">
    {settingsError}
  </div>
{/if}

<SettingsForm
  {schema}
  embedded
  compact={false}
  custom={defineSettingsCustomControls({
    'max-concurrent-agents': maxConcurrentControl,
    'flush-queued-messages': flushQueuedMessagesControl,
    'memory-budget': memoryBudgetControl,
    'idle-reap': idleReapControl,
    'idle-reap-minutes-row': idleReapMinutesControl,
    'acp-node-heap': acpHeapControl,
  })}
  descriptions={{
    'memory-budget': memoryBudgetDescription,
    'idle-reap': idleReapDescription,
    'acp-node-heap': acpHeapDescription,
  }}
/>
