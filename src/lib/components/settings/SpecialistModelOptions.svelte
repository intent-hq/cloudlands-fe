<script lang="ts">
  /**
   * "+ Add model option" rows for the specialist editor (PROTOCOL §5.11
   * `modelOptions`): each row is a ModelPicker + free-text hint + remove
   * button. Rows without a picked model are local drafts — they are never
   * committed; a commit fires when a row gains a model, a hint blurs on a
   * committed row, or a committed row is removed. The parent persists the
   * committed list via `saveFileSpecialist` (empty list ⇒ key omitted on the
   * wire so inheritance is preserved).
   */
  import Fa from 'svelte-fa';
  import { faPlus, faXmark } from '@fortawesome/free-solid-svg-icons';

  import ModelPicker from '$lib/components/chat/input/ModelPicker.svelte';
  import type { SpecialistModelOption } from '$shared/specialist-file-types';
  import { m } from '$shared/paraglide/messages.js';

  interface Props {
    /** Saved options from the resolved specialist view (wire `modelOptions`). */
    savedOptions?: SpecialistModelOption[];
    /** Persist the committed (model-bearing) rows. */
    onCommit: (options: SpecialistModelOption[]) => void;
  }

  let { savedOptions, onCommit }: Props = $props();

  // Local rows: saved options plus any draft rows (model === ''). Hints are
  // committed on blur (the input is not two-way bound), so typing never
  // mutates `rows` and the sync effect below stays quiescent mid-edit.
  let rows = $state<SpecialistModelOption[]>([]);

  function committed(list: SpecialistModelOption[]): SpecialistModelOption[] {
    return list.filter((row) => row.model !== '');
  }

  // Resync from the store only when the saved list diverges from the local
  // committed rows (specialist switch, external edit, post-commit refetch
  // with a different result). Draft rows survive unrelated refetches.
  $effect(() => {
    const saved = savedOptions ?? [];
    const local = committed(rows);
    const inSync =
      saved.length === local.length &&
      saved.every((opt, i) => opt.model === local[i].model && opt.hint === local[i].hint);
    if (!inSync) {
      rows = saved.map((opt) => ({ ...opt }));
    }
  });

  function addRow() {
    rows = [...rows, { model: '', hint: '' }];
  }

  function handleModelChange(index: number, compoundModelId: string) {
    if (!compoundModelId) return;
    rows = rows.map((row, i) => (i === index ? { ...row, model: compoundModelId } : row));
    onCommit(committed(rows));
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

  {#each rows as row, index (index)}
    <div class="flex items-center gap-2">
      <div class="shrink-0">
        <ModelPicker
          selectedModel={row.model || undefined}
          onModelChange={(model) => handleModelChange(index, model)}
          showDefaultOption={false}
          defaultModelLabel={m.settings_aiBehavior_modelOptions_selectModel_label()}
          variant="default"
          size="sm"
        />
      </div>
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
