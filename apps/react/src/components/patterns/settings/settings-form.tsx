// Source: src/lib/components/patterns/settings/SettingsForm.svelte.
import { useSignals } from '@preact/signals-react/runtime';
import { SettingsFieldRow } from './settings-field-row';
import { SettingsSection } from './settings-section';
import { SettingsControl } from './settings-control';
import { matchesSettingsSearch, resolveSetting } from './schema';
import type { SettingsCustomControls, SettingsDescriptionSnippets, SettingsSchema } from './types';

export interface SettingsFormProps {
  schema: SettingsSchema;
  searchQuery?: string;
  custom?: SettingsCustomControls;
  descriptions?: SettingsDescriptionSnippets;
  embedded?: boolean;
  compact?: boolean;
}
export function SettingsForm({
  schema,
  searchQuery = '',
  custom = {},
  descriptions = {},
  embedded = false,
  compact = true,
}: SettingsFormProps) {
  // Resolvable callbacks can read ReactStore signals without a syntactic .value in this component.
  useSignals();
  const sections = schema.sections
    .filter((section) => section.when?.() ?? true)
    .map((section) => ({
      ...section,
      entries: section.entries.filter(
        (entry) => (entry.when?.() ?? true) && matchesSettingsSearch(entry, searchQuery),
      ),
    }))
    .filter((section) => section.entries.length > 0);
  function rows(entries: SettingsSchema['sections'][number]['entries']) {
    return entries.map((entry) => {
      const controlId = `setting-${entry.id}`;
      const disabled = resolveSetting(entry.disabled, false);
      const busy = resolveSetting(entry.busy, false);
      return (
        <SettingsFieldRow
          key={entry.id}
          compact={compact}
          id={entry.id}
          label={entry.label}
          description={entry.description}
          descriptionContent={descriptions[entry.id]}
          controlOnly={entry.kind === 'custom' && entry.layout === 'full-width'}
          htmlFor={
            ['select', 'input', 'number', 'path', 'keybinding'].includes(entry.kind)
              ? controlId
              : undefined
          }
          activateLabel={entry.kind === 'select'}
          disabled={disabled}
          busy={busy}
          error={resolveSetting(entry.error, undefined)}
          status={resolveSetting(entry.status, undefined)}
          statusTone={entry.statusTone}
          danger={entry.danger}
          experimental={entry.experimental}
          featureCode={entry.featureCode}
          searchText={[entry.label, entry.description, entry.featureCode].filter(Boolean).join(' ')}
          className={entry.className ?? entry.class}
          control={({ labelId, descriptionId, errorId }) => {
            const context = { entry, controlId, labelId, descriptionId, errorId, disabled, busy };
            return entry.kind === 'custom' ? (
              custom[entry.id]?.(context)
            ) : (
              <SettingsControl entry={entry} context={context} compact={compact} />
            );
          }}
        />
      );
    });
  }
  return embedded ? (
    <div
      data-slot="settings-form"
      className="@container/settings-form min-w-0 divide-y divide-border"
    >
      {sections.flatMap((section) => rows(section.entries))}
    </div>
  ) : (
    <div data-slot="settings-form" className="@container/settings-form min-w-0 space-y-10">
      {sections.map((section) => (
        <SettingsSection
          key={section.id}
          id={section.id}
          title={section.title}
          description={section.description}
        >
          {rows(section.entries)}
        </SettingsSection>
      ))}
    </div>
  );
}
