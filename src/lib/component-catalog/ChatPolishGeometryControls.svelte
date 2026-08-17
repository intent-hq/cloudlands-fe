<script lang="ts">
  import { onMount } from 'svelte';
  import {
    chatPolishGeometryControls,
    clearChatPolishPreferences,
    defaultChatPolishGeometry,
    formatChatPolishGeometry,
    readChatPolishPreferences,
    writeChatPolishPreferences,
    type ChatPolishGeometry,
  } from './chat-polish/chat-polish-geometry';

  let {
    geometry = $bindable({ ...defaultChatPolishGeometry }),
  }: {
    geometry?: ChatPolishGeometry;
  } = $props();
  let hydrated = $state(false);
  let savedSignature = $state(signature(geometry));
  let storageStatus = $state<'idle' | 'saved' | 'save-failed' | 'reset' | 'reset-failed'>('idle');

  function signature(value: ChatPolishGeometry) {
    return JSON.stringify(value);
  }

  const dirty = $derived(signature(geometry) !== savedSignature);
  const feedback = $derived(
    storageStatus === 'save-failed'
      ? 'Could not save tweaks. Preview changes are still active.'
      : storageStatus === 'reset-failed'
        ? 'Defaults restored, but the saved override could not be cleared.'
        : dirty
          ? 'Unsaved changes'
          : storageStatus === 'reset'
            ? 'Production defaults restored'
            : 'All tweaks saved',
  );

  onMount(() => {
    const saved = readChatPolishPreferences(localStorage);
    geometry = saved.geometry;
    savedSignature = signature(geometry);
    hydrated = true;
  });

  function update(nextGeometry = geometry) {
    geometry = nextGeometry;
    storageStatus = 'idle';
  }

  function updateNumber(key: keyof ChatPolishGeometry, event: Event) {
    update({ ...geometry, [key]: Number((event.currentTarget as HTMLInputElement).value) });
  }

  function updateBoolean(key: 'compact' | 'stickySimulation', event: Event) {
    update({ ...geometry, [key]: (event.currentTarget as HTMLInputElement).checked });
  }

  function save() {
    const saved = writeChatPolishPreferences(localStorage, {
      geometry,
      selectedScenario: 'comprehensive-conversation',
    });
    if (saved) savedSignature = signature(geometry);
    storageStatus = saved ? 'saved' : 'save-failed';
  }

  function reset() {
    geometry = { ...defaultChatPolishGeometry };
    const cleared = clearChatPolishPreferences(localStorage);
    if (cleared) savedSignature = signature(geometry);
    storageStatus = cleared ? 'reset' : 'reset-failed';
  }
</script>

<section class="geometry-controls" aria-labelledby="chat-polish-controls-title">
  <div class="controls-heading">
    <div>
      <h2 id="chat-polish-controls-title" class="text-sm font-medium">Geometry controls</h2>
      <p class="type-caption text-muted-foreground">
        Preview-only values; catalog theme controls remain above.
      </p>
    </div>
  </div>

  <div class="state-controls">
    <label class="check-control">
      <input
        type="checkbox"
        checked={geometry.compact}
        onchange={(event) => updateBoolean('compact', event)}
      />
      <span>Compact mode</span>
    </label>
    <label class="check-control">
      <input
        type="checkbox"
        checked={geometry.stickySimulation}
        onchange={(event) => updateBoolean('stickySimulation', event)}
      />
      <span>Simulate sticky user messages</span>
    </label>
  </div>

  <div class="range-grid">
    {#each chatPolishGeometryControls as control (control.key)}
      <label class="range-control">
        <span>{control.label}</span>
        <input
          id={`chat-polish-${control.key}`}
          type="range"
          min={control.min}
          max={control.max}
          step={control.step}
          value={geometry[control.key] as number}
          aria-label={control.label}
          aria-valuetext={`${geometry[control.key]} ${control.unit}`}
          oninput={(event) => updateNumber(control.key, event)}
        />
        <output for={`chat-polish-${control.key}`}>{geometry[control.key]}{control.unit}</output>
      </label>
    {/each}
    <div class="fixed-readout" aria-label="Nested group spacing">
      <span>Nested group spacing</span>
      <output>6px fixed</output>
    </div>
    <div class="fixed-readout" aria-label="Expanded content bottom gap">
      <span>Expanded content bottom gap</span>
      <output>16px fixed</output>
    </div>
  </div>

  <output class="values-readout" aria-label="Current geometry values" aria-live="polite">
    {formatChatPolishGeometry(geometry)}
  </output>
  <div class="save-actions">
    <button type="button" class="save-button" disabled={!hydrated || !dirty} onclick={save}>
      Save tweaks
    </button>
    <button type="button" class="reset-button" onclick={reset}>Reset production defaults</button>
  </div>
  <p class:dirty class="save-feedback" role="status" aria-label="Save status" aria-live="polite">
    {feedback}
  </p>
</section>

<style>
  .geometry-controls {
    display: grid;
    gap: 0.75rem;
    padding: 0.875rem;
    border: 1px solid hsl(var(--border));
    border-radius: var(--radius-large);
    background: hsl(var(--card));
    box-shadow: var(--elevation-raised);
  }
  .controls-heading,
  .state-controls {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 0.75rem;
  }
  .state-controls {
    display: grid;
    align-items: stretch;
  }
  .state-controls label {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    font-size: var(--text-caption-size);
  }
  .save-button,
  .reset-button {
    min-height: var(--control-height-small);
    border: 1px solid hsl(var(--border));
    border-radius: var(--radius-small);
    background: hsl(var(--background));
    padding-inline: 0.5rem;
    color: hsl(var(--foreground));
    font-size: var(--text-caption-size);
  }
  .save-button,
  .reset-button {
    cursor: pointer;
  }
  .save-button {
    border-color: hsl(var(--primary));
    background: hsl(var(--primary));
    color: hsl(var(--primary-foreground));
  }
  .save-button:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }
  input:focus-visible,
  .save-button:focus-visible,
  .reset-button:focus-visible {
    outline: 2px solid hsl(var(--ring));
    outline-offset: 2px;
  }
  .range-grid {
    display: grid;
    gap: 0.625rem;
  }
  .range-control {
    display: grid;
    min-width: 0;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 0.25rem 0.5rem;
    align-items: center;
  }
  .range-control span {
    font-size: var(--text-caption-size);
    color: hsl(var(--muted-foreground));
  }
  .range-control input {
    grid-column: 1 / -1;
    width: 100%;
  }
  .range-control output {
    width: 3.25rem;
    text-align: end;
    font: var(--text-code-size)/1 var(--font-mono);
  }
  .fixed-readout {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    color: hsl(var(--muted-foreground));
    font-size: var(--text-caption-size);
  }
  .fixed-readout output {
    font: var(--text-code-size)/1 var(--font-mono);
  }
  .values-readout {
    overflow-wrap: anywhere;
    border-radius: var(--radius-small);
    background: hsl(var(--muted));
    padding: 0.375rem 0.5rem;
    color: hsl(var(--muted-foreground));
    font: var(--text-code-size)/1.4 var(--font-mono);
  }
  .save-actions {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.5rem;
  }
  .save-feedback {
    margin: 0;
    color: hsl(var(--muted-foreground));
    font-size: var(--text-caption-size);
  }
  .save-feedback.dirty {
    color: hsl(var(--foreground));
  }
  @media (max-width: 639px) {
    .save-actions {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
