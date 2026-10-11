// Source: src/lib/components/chat/HarnessFeaturesModal.svelte.
import { ContentDialog } from '@/components/patterns/confirm';
import { ListRow } from '@/components/patterns/collection';
import { m } from '$shared/paraglide/messages.js';
import { buildHarnessFeatureRows } from '$lib/components/chat/harness-feature-catalog';

export interface HarnessFeaturesModalProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  static?: boolean;
  /** Harness version stamp, rendered in the title (verbatim). */
  version: string;
  /** Session snapshot; null/absent renders all catalog rows OFF. */
  features?: Record<string, boolean> | null;
}

export function HarnessFeaturesModal({
  open = false,
  onOpenChange,
  static: staticPosition = false,
  version,
  features = null,
}: HarnessFeaturesModalProps) {
  const rows = buildHarnessFeatureRows(features);
  const groups = [
    {
      enabled: true,
      label: m.chat_shared_valueOn_label(),
      rows: rows.filter((row) => row.enabled),
    },
    {
      enabled: false,
      label: m.chat_shared_valueOff_label(),
      rows: rows.filter((row) => !row.enabled),
    },
  ];

  return (
    <ContentDialog
      open={open}
      onOpenChange={onOpenChange}
      static={staticPosition}
      title={m.chat_harnessFeaturesModal_title({ version })}
      description={m.chat_harnessFeaturesModal_description()}
      size="wide"
    >
      <div className="@container">
        <div
          className="grid grid-cols-1 gap-6 @min-[28rem]:grid-cols-2"
          data-testid="harness-features-list"
        >
          {groups.map((group) => (
            <section key={String(group.enabled)} className="min-w-0" aria-label={group.label}>
              <h3 className="text-sm font-medium mb-3">{group.label}</h3>
              <ul className="space-y-4">
                {group.rows.length > 0 ? (
                  group.rows.map((row) => (
                    <li key={row.key}>
                      <ListRow
                        className="min-h-0 px-0 py-0 [&_.truncate]:whitespace-normal"
                        data-testid="harness-feature-state"
                        data-feature={row.key}
                        data-enabled={row.enabled}
                        title={row.label}
                        description={<>{row.description}</>}
                      />
                    </li>
                  ))
                ) : (
                  <li className="text-xs text-subtle" aria-hidden="true">
                    {/* i18n-ignore (decorative empty-group marker) */}—
                  </li>
                )}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </ContentDialog>
  );
}
