<script lang="ts">
  import SettingsFieldRow from './SettingsFieldRow.svelte';
  import SettingsSection from './SettingsSection.svelte';
  import SettingsControl from './SettingsControl.svelte';
  import { matchesSettingsSearch, resolveSetting } from './schema';
  import type { SettingsCustomControls, SettingsSchema } from './types';

  let {
    schema,
    searchQuery = '',
    custom = {},
  }: {
    schema: SettingsSchema;
    searchQuery?: string;
    custom?: SettingsCustomControls;
  } = $props();
  const sections = $derived(
    schema.sections
      .filter((section) => section.when?.() ?? true)
      .map((section) => ({
        ...section,
        entries: section.entries.filter(
          (entry) => (entry.when?.() ?? true) && matchesSettingsSearch(entry, searchQuery),
        ),
      }))
      .filter((section) => section.entries.length > 0),
  );
  const hasLabelTarget = (kind: string) =>
    ['select', 'input', 'number', 'path', 'keybinding'].includes(kind);
</script>

<div data-slot="settings-form" class="min-w-0 space-y-10">
  {#each sections as section (section.id)}
    <SettingsSection id={section.id} title={section.title} description={section.description}>
      {#each section.entries as entry (entry.id)}
        {@const controlId = `setting-${entry.id}`}
        {@const disabled = resolveSetting(entry.disabled, false)}
        {@const busy = resolveSetting(entry.busy, false)}
        {@const error = resolveSetting(entry.error, undefined)}
        {@const status = resolveSetting(entry.status, undefined)}
        <SettingsFieldRow
          id={entry.id}
          label={entry.label}
          description={entry.description}
          htmlFor={hasLabelTarget(entry.kind) ? controlId : undefined}
          {disabled}
          {busy}
          {error}
          {status}
          statusTone={entry.statusTone}
          danger={entry.danger}
          experimental={entry.experimental}
          featureCode={entry.featureCode}
          searchText={[entry.label, entry.description, entry.featureCode].filter(Boolean).join(' ')}
        >
          {#snippet control({ labelId, descriptionId, errorId })}
            {@const context = {
              entry,
              controlId,
              labelId,
              descriptionId,
              errorId,
              disabled,
              busy,
            }}
            {#if entry.kind === 'custom'}
              {#if custom[entry.id]}{@render custom[entry.id](context)}{/if}
            {:else}
              <SettingsControl {entry} {context} />
            {/if}
          {/snippet}
        </SettingsFieldRow>
      {/each}
    </SettingsSection>
  {/each}
</div>
