<script lang="ts">
  import { Button, Textarea } from '$lib/components/patterns/settings/custom-controls';
  import { SettingsFieldRow } from '$lib/components/patterns/settings';
  /**
   * "+ Add model option" rows for the specialist editor (PROTOCOL §5.11
   * `modelOptions`): each row is a stacked ModelPicker, multi-line
   * free-text hint and "× Remove" button. Rows without a picked model are
   * local drafts — they are never committed; a commit fires when a row gains
   * a model, a hint blurs or the effort changes on a committed row, or a
   * committed row is removed. The parent persists the committed list via
   * `saveFileSpecialist` (empty list ⇒ key omitted on the wire so
   * inheritance is preserved).
   *
   * Rows carry the triple shape `{ provider?, model, hint, reasoningEffort? }`
   * with a BARE `model` id (PROTOCOL §5.11); the ModelPicker boundary still
   * speaks compound ids, so the row's pair recombines for display while picks
   * consume the resolved triple legs the picker emits. The effort level is
   * chosen inside the picker dropdown (mirroring the main Model row) — there
   * is no separate per-row effort control.
   */
  import { tick, untrack } from 'svelte';
  import Fa from 'svelte-fa';
  import { faPlus, faXmark } from '@fortawesome/free-solid-svg-icons';

  import ModelPicker from '$lib/components/chat/input/ModelPicker.svelte';
  import type { SpecialistModelOption } from '$shared/specialist-file-types';
  import { splitLegacyCompoundId } from '$shared/utils/legacy-model-id';
  import { m } from '$shared/paraglide/messages.js';
  import { selectProviderModelEffortLevels } from '$store/renderer/slices/model/model-selectors';
  import { store as appStore } from '$store/renderer/store';

  interface Props {
    workspaceId?: string;
    readonly?: boolean;
    /** Saved options from the resolved specialist view (wire `modelOptions`). */
    savedOptions?: SpecialistModelOption[];
    /** Persist the committed (model-bearing) rows. */
    onCommit: (options: SpecialistModelOption[]) => void;
  }

  let { savedOptions, onCommit, workspaceId, readonly = false }: Props = $props();

  // Local rows: saved options plus any draft rows (model === ''). Hints are
  // committed on blur (the textarea is not two-way bound; Enter inserts a
  // newline), so typing never mutates `rows` and the sync effect below stays
  // quiescent mid-edit. Each
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
   * catalog no longer offers. The lookup is provider-scoped: a cross-provider
   * pick consults the resolved provider's cached catalog, not the active one.
   */
  function effortForModel(
    providerId: string | undefined,
    modelId: string,
    effort: string | undefined,
  ): string | undefined {
    if (!effort) return undefined;
    const levels = selectProviderModelEffortLevels.select(
      appStore.state,
      providerId,
      modelId,
      workspaceId,
    );
    return levels?.includes(effort) ? effort : undefined;
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

  let listEl = $state<HTMLDivElement | null>(null);

  /**
   * Append a draft row and move keyboard focus to its model picker so the
   * next step (choosing a model) is one keypress away. The shared ModelPicker
   * exposes no focus API, so the new row's first button is found after render.
   */
  async function addRow() {
    rows = [...rows, { key: nextKey++, model: '', hint: '' }];
    await tick();
    const pickers = listEl?.querySelectorAll<HTMLElement>('[data-model-option-picker]');
    pickers?.[pickers.length - 1]?.querySelector<HTMLElement>('button')?.focus();
  }

  function handleModelChange(
    index: number,
    compoundModelId: string,
    pick?: { providerId: string; modelId: string },
  ) {
    if (!compoundModelId) return;
    // Prefer the resolved triple legs the picker emits (catalog-group
    // attribution for bare cross-provider picks); fall back to splitting a
    // legacy compound id (an empty prefix never propagates as a provider id).
    const { providerId, modelId } = pick ?? splitLegacyCompoundId(compoundModelId);
    rows = rows.map((row, i) =>
      i === index
        ? {
            ...row,
            provider: providerId || undefined,
            model: modelId,
            reasoningEffort: effortForModel(providerId || undefined, modelId, row.reasoningEffort),
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

{#if readonly}
  {#each savedOptions ?? [] as option}
    <p class="type-body text-muted-foreground break-words">
      {option.provider ? `${option.provider}:` : ''}{option.model}{option.reasoningEffort
        ? ` · ${option.reasoningEffort}`
        : ''}
    </p>
    {#if option.hint}
      <!-- Keep the text flush with the tags: `whitespace-pre-line` would show
           formatter indentation as an extra blank line. -->
      <!-- prettier-ignore -->
      <p class="type-body text-muted-foreground break-words whitespace-pre-line">{option.hint}</p>
    {/if}
  {/each}
{:else}
  <SettingsFieldRow
    id="specialist-model-options"
    label={m.settings_aiBehavior_modelOptions_label()}
    description={m.settings_aiBehavior_modelOptions_description()}
    compact
  >
    <!-- Each option is a stacked block (picker / hint / Remove). The gap
         between blocks (and before Add) is larger than any gap inside one, so
         each Remove reads as belonging to its own option. -->
    <div class="flex min-w-0 flex-col gap-6" bind:this={listEl}>
      {#each rows as row, index (row.key)}
        <div class="flex min-w-0 flex-col items-start gap-2" data-model-option-row>
          <div class="min-w-0 max-w-full" data-model-option-picker>
            <ModelPicker
              {workspaceId}
              selectedModel={pickerModelId(row) || undefined}
              onModelChange={(model, pick) => handleModelChange(index, model, pick)}
              showDefaultOption={false}
              defaultModelLabel={m.settings_aiBehavior_modelOptions_selectModel_label()}
              variant="default"
              size="sm"
              showReasoning
              reasoningEffort={row.reasoningEffort ?? null}
              onReasoningChange={(effort) => handleEffortChange(index, effort ?? undefined)}
            />
          </div>
          <!-- `field-sizing: content` sizes the box from its text whenever it
               is laid out — including the moment the hidden Advanced section
               is revealed and on width changes — clamped to ≈3–8 lines. The
               shared autoResize measures only on mount/input, which reads 0
               inside the hidden disclosure and clips saved hints. -->
          <Textarea
            value={row.hint}
            rows={3}
            onblur={(e) => handleHintBlur(index, e.currentTarget.value.trim())}
            placeholder={m.settings_aiBehavior_modelOptions_hint_placeholder()}
            class="max-h-40.5 min-h-18 w-full resize-none overflow-y-auto py-2 field-sizing-content"
          />
          <Button
            variant="ghost"
            size="xs"
            type="button"
            onclick={() => removeRow(index)}
            aria-label={m.settings_aiBehavior_modelOptions_remove_ariaLabel()}
            class="shrink-0"
          >
            {#snippet leadingIcon()}<Fa icon={faXmark} class="size-3" />{/snippet}
            {m.settings_aiBehavior_modelOptions_remove_label()}
          </Button>
        </div>
      {/each}

      <Button
        variant="link"
        size="sm"
        type="button"
        onclick={addRow}
        class="w-fit justify-start px-0"
      >
        {m.settings_aiBehavior_modelOptions_add()}
        {#snippet trailingIcon()}<Fa icon={faPlus} class="size-3" />{/snippet}
      </Button>
    </div>
  </SettingsFieldRow>
{/if}
