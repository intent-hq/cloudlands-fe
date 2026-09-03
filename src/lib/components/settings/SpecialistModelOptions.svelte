<script lang="ts">
  /**
   * "+ Add model option" rows for the specialist editor (PROTOCOL §5.11
   * `modelOptions`): each row is a ModelPicker + free-text
   * hint + remove button. Rows without a picked model are local drafts — they
   * are never committed; a commit fires when a row gains a model, a hint blurs
   * or the effort changes on a committed row, or a committed row is removed.
   * The parent persists the committed list via `saveFileSpecialist` (empty
   * list ⇒ key omitted on the wire so inheritance is preserved).
   *
   * Rows carry the triple shape `{ provider?, model, hint, reasoningEffort? }`
   * with a BARE `model` id (PROTOCOL §5.11); the ModelPicker boundary still
   * speaks compound ids, so picks split into provider + bare model and the
   * row's pair recombines for display. Each row also renders a textual effort
   * label ("Default" when the option inherits the model default).
   */
  import { untrack } from 'svelte';
  import Fa from 'svelte-fa';
  import { faPlus, faXmark } from '@fortawesome/free-solid-svg-icons';

  import ModelPicker from '$lib/components/chat/input/ModelPicker.svelte';
  import type { SpecialistModelOption } from '$shared/specialist-file-types';
  import { splitLegacyCompoundId } from '$shared/utils/legacy-model-id';
  import { m } from '$shared/paraglide/messages.js';
  import { selectModelEffortLevels } from '$store/renderer/slices/model/model-selectors';
  import { store as appStore } from '$store/renderer/store';

  interface Props {
    /** Saved options from the resolved specialist view (wire `modelOptions`). */
    savedOptions?: SpecialistModelOption[];
    /** Persist the committed (model-bearing) rows. */
    onCommit: (options: SpecialistModelOption[]) => void;
  }

  let { savedOptions, onCommit }: Props = $props();

  // Local rows: saved options plus any draft rows (model === ''). Hints are
  // committed on blur (the input is not two-way bound), so typing never
  // mutates `rows` and the sync effect below stays quiescent mid-edit. Each
  // row carries a stable local key so the {#each} block never re-associates
  // DOM (in-flight input text, pickers) with a different row after a removal.
  interface Row extends SpecialistModelOption {
    key: number;
  }
  let nextKey = 0;
  let rows = $state<Row[]>([]);

  function committed(list: Row[]): SpecialistModelOption[] {
    return list
      .filter((row) => row.model !== '')
      .map(({ provider, model, hint, reasoningEffort }) => ({
        // Omit unset keys so the wire keeps inherit semantics
        // (PROTOCOL §5.11 — never null/"" on a modelOptions entry).
        ...(provider ? { provider } : {}),
        model,
        hint,
        ...(reasoningEffort ? { reasoningEffort } : {}),
      }));
  }

  /**
   * Compound id for the ModelPicker boundary (display + catalog lookups).
   * The picker still speaks `provider:model` ids; the row stores the triple.
   */
  function pickerModelId(row: SpecialistModelOption): string {
    if (!row.model) return '';
    return row.provider ? `${row.provider}:${row.model}` : row.model;
  }

  /**
   * Drop an effort level the newly picked model does not advertise, so a
   * model switch resets the row to Default instead of persisting a level the
   * catalog no longer offers. `model` is a picker compound id.
   */
  function effortForModel(model: string, effort: string | undefined): string | undefined {
    if (!effort) return undefined;
    const levels = selectModelEffortLevels.select(appStore.state, model);
    return levels?.includes(effort) ? effort : undefined;
  }

  // Textual per-row effort label so the level is readable at a glance
  // (mirrors EffortPicker's level naming); unset reads as "Default", never
  // blank.
  const LEVEL_LABELS: Record<string, () => string> = {
    none: () => m.chat_shared_valueOff_label(),
    minimal: () => m.chat_effortPicker_level_minimal(),
    low: () => m.chat_effortPicker_level_low(),
    medium: () => m.chat_effortPicker_level_medium(),
    high: () => m.chat_effortPicker_level_high(),
    xhigh: () => m.chat_effortPicker_level_xhigh(),
    max: () => m.chat_effortPicker_level_max(),
  };

  function effortLabel(row: SpecialistModelOption): string {
    const level = row.reasoningEffort
      ? (LEVEL_LABELS[row.reasoningEffort]?.() ?? row.reasoningEffort)
      : m.settings_aiBehavior_modelOptions_effortDefault_label();
    return m.settings_aiBehavior_modelOptions_effort_label({ level });
  }

  // Resync from the store only when the saved list diverges from the local
  // committed rows (specialist switch, external edit, post-commit refetch
  // with a different result). `rows` is read via `untrack` so local commits
  // (which mutate `rows` before the refetch lands) never re-run the effect
  // against stale savedOptions — only savedOptions changes trigger a resync.
  // Draft rows survive refetches that echo the local committed list.
  $effect(() => {
    const saved = savedOptions ?? [];
    const local = untrack(() => committed(rows));
    const inSync =
      saved.length === local.length &&
      saved.every(
        (opt, i) =>
          (opt.provider ?? undefined) === (local[i].provider ?? undefined) &&
          opt.model === local[i].model &&
          opt.hint === local[i].hint &&
          (opt.reasoningEffort ?? undefined) === (local[i].reasoningEffort ?? undefined),
      );
    if (!inSync) {
      rows = saved.map((opt) => ({ key: nextKey++, ...opt }));
    }
  });

  function addRow() {
    rows = [...rows, { key: nextKey++, model: '', hint: '' }];
  }

  function handleModelChange(index: number, compoundModelId: string) {
    if (!compoundModelId) return;
    // Split the picker's compound id into the triple's provider + bare model
    // (an empty legacy prefix never propagates as a real provider id).
    const { providerId, modelId } = splitLegacyCompoundId(compoundModelId);
    rows = rows.map((row, i) =>
      i === index
        ? {
            ...row,
            provider: providerId || undefined,
            model: modelId,
            reasoningEffort: effortForModel(compoundModelId, row.reasoningEffort),
          }
        : row,
    );
    onCommit(committed(rows));
  }

  /**
   * Per-row effort change. A draft row (no model yet) only updates locally —
   * it is committed once the row gains a model, mirroring the hint semantics.
   */
  function handleEffortChange(index: number, reasoningEffort: string | undefined) {
    const row = rows[index];
    if (!row || row.reasoningEffort === reasoningEffort) return;
    const wasCommitted = row.model !== '';
    rows = rows.map((r, i) => (i === index ? { ...r, reasoningEffort } : r));
    if (wasCommitted) {
      onCommit(committed(rows));
    }
  }

  function handleHintBlur(index: number, hint: string) {
    const wasCommitted = rows[index]?.model !== '';
    if (rows[index]?.hint === hint) return;
    rows = rows.map((row, i) => (i === index ? { ...row, hint } : row));
    if (wasCommitted) {
      onCommit(committed(rows));
    }
  }

  function removeRow(index: number) {
    const wasCommitted = rows[index]?.model !== '';
    rows = rows.filter((_, i) => i !== index);
    if (wasCommitted) {
      onCommit(committed(rows));
    }
  }
</script>

<div class="flex flex-col gap-2">
  <div>
    <span class="text-sm font-medium text-foreground">
      {m.settings_aiBehavior_modelOptions_label()}
    </span>
    <p class="text-xs text-muted-foreground mt-0.5">
      {m.settings_aiBehavior_modelOptions_description()}
    </p>
  </div>

  {#each rows as row, index (row.key)}
    <div class="flex items-center gap-2">
      <div class="shrink-0">
        <ModelPicker
          selectedModel={pickerModelId(row) || undefined}
          onModelChange={(model) => handleModelChange(index, model)}
          showDefaultOption={false}
          defaultModelLabel={m.settings_aiBehavior_modelOptions_selectModel_label()}
          variant="default"
          size="sm"
          showReasoning
          reasoningEffort={row.reasoningEffort ?? null}
          onReasoningChange={(effort) => handleEffortChange(index, effort ?? undefined)}
        />
      </div>
      <span class="shrink-0 text-xs text-muted-foreground whitespace-nowrap" data-testid="effort-label">
        {effortLabel(row)}
      </span>
      <input
        type="text"
        value={row.hint}
        onblur={(e) => handleHintBlur(index, e.currentTarget.value.trim())}
        onkeydown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            e.currentTarget.blur();
          }
        }}
        placeholder={m.settings_aiBehavior_modelOptions_hint_placeholder()}
        class="flex-1 min-w-0 h-8 px-2.5 text-sm rounded-md border border-input bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
      />
      <button
        type="button"
        onclick={() => removeRow(index)}
        aria-label={m.settings_aiBehavior_modelOptions_remove_ariaLabel()}
        class="shrink-0 p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
      >
        <Fa icon={faXmark} class="w-3.5 h-3.5" />
      </button>
    </div>
  {/each}

  <div>
    <button
      type="button"
      onclick={addRow}
      class="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1.5 cursor-pointer"
    >
      <Fa icon={faPlus} class="w-3 h-3" />
      {m.settings_aiBehavior_modelOptions_add()}
    </button>
  </div>
</div>
