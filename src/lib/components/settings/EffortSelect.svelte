<script lang="ts">
  /**
   * Reasoning-effort dropdown for the specialist editor (PROTOCOL §5.11
   * `reasoningEffort`). The options are the selected model's catalog
   * `effortLevels` plus a "Default" entry meaning unset (inherit the model
   * default). Renders nothing when the model advertises no levels, so a
   * model without effort support shows no dead control.
   *
   * Level ids are provider-interpreted wire values (`low`/`medium`/`high`/…)
   * and are shown verbatim — the daemon owns the vocabulary.
   */
  import { Select } from '$lib/components/ui/select';
  import { selectAvailableModels, selectModelEffortLevels } from '$store/renderer/slices/model/model-selectors';
  import { store as appStore } from '$store/renderer/store';
  import { m } from '$shared/paraglide/messages.js';

  interface Props {
    /** Compound model id the effort applies to; `undefined` when inheriting. */
    model?: string;
    /** Current level, or `undefined` for Default (unset). */
    value?: string;
    /** Fired with the picked level, or `undefined` when Default was picked. */
    onChange: (effort: string | undefined) => void;
    /** Test hook on the wrapper so suites can scope queries to one row. */
    testId?: string;
  }

  let { model, value, onChange, testId }: Props = $props();

  const triggerId = `effort-select-${crypto.randomUUID()}`;

  // Track catalog loads so the levels resolve once `model.availableModels`
  // lands (the selector reads the catalog collection).
  const availableModels$ = selectAvailableModels();

  const levels = $derived.by(() => {
    void $availableModels$;
    return selectModelEffortLevels.select(appStore.state, model) ?? [];
  });

  const hasLevels = $derived(levels.length > 0);

  // Default sentinel: the ui Select carries string values only, so "unset" is
  // an empty string on the control and `undefined` on the wire.
  const selectedValue = $derived(value && levels.includes(value) ? value : '');

  const selectedLabel = $derived(selectedValue || m.settings_aiBehavior_effort_default_label());

  function handleChange(picked: string) {
    onChange(picked || undefined);
  }
</script>

{#if hasLevels}
  <div class="shrink-0 w-[110px]" data-testid={testId}>
    <label class="sr-only" for={triggerId}>{m.settings_aiBehavior_effort_label()}</label>
    <Select.Root value={selectedValue} onchange={handleChange}>
      <Select.Trigger id={triggerId} class="h-8 py-1">
        <span class="truncate">{selectedLabel}</span>
      </Select.Trigger>
      <Select.Content portal class="max-h-[300px] w-[110px]">
        <Select.Item value="">
          <span class="truncate">{m.settings_aiBehavior_effort_default_label()}</span>
        </Select.Item>
        {#each levels as level (level)}
          <Select.Item value={level}>
            <!-- i18n-ignore (provider-interpreted wire level id) -->
            <span class="truncate">{level}</span>
          </Select.Item>
        {/each}
      </Select.Content>
    </Select.Root>
  </div>
{/if}
