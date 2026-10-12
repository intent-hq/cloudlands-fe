// Source: src/lib/components/chat/ExecutionPlanCard.svelte.
import { IconDefinitionIcon } from '@/components/icons/icon-definition';
import { IntentMarkLoader } from '@/components/ui/indicators';
import {
  CHAT_OPERATIONAL_ICON_CLASS,
  CHAT_OPERATIONAL_LEADING_CLASS,
  OPERATIONAL_ROW_GEOMETRY_TOKENS_CLASS,
} from '$lib/components/chat/operational-disclosure-classes';
import { faCheck, faCircle, faListCheck } from '$lib/icons/phosphor-icon-definitions';
import { formatInteger } from '$lib/i18n/format';
import { m } from '$shared/paraglide/messages.js';
import type { PlanEntry, PlanEntryStatus } from '$shared/types';

export interface ExecutionPlanCardProps {
  entries: PlanEntry[];
}

function statusLabel(status: PlanEntryStatus): string {
  if (status === 'completed') return m.chat_executionPlan_completed_label();
  if (status === 'in_progress') return m.chat_executionPlan_current_label();
  return m.chat_executionPlan_pending_label();
}

export function ExecutionPlanCard({ entries }: ExecutionPlanCardProps) {
  const currentIndex = entries.findIndex((entry) => entry.status === 'in_progress');
  const pendingIndex = entries.findIndex((entry) => entry.status === 'pending');
  const currentStep =
    currentIndex >= 0 ? currentIndex + 1 : pendingIndex >= 0 ? pendingIndex + 1 : entries.length;

  if (entries.length === 0) return null;

  return (
    <section
      className="my-2 w-full min-w-0 max-w-full overflow-hidden rounded-lg border border-border bg-background/60 font-family-child"
      aria-label={m.chat_executionPlan_title()}
      data-testid="execution-plan-card"
    >
      <div
        className={`${OPERATIONAL_ROW_GEOMETRY_TOKENS_CLASS} grid min-h-8 min-w-0 grid-cols-[var(--operational-leading-slot-size)_minmax(0,1fr)_auto] items-center gap-2 bg-muted/30 px-2 py-1.5`}
      >
        <span className={CHAT_OPERATIONAL_LEADING_CLASS} aria-hidden="true">
          <IconDefinitionIcon
            icon={faListCheck}
            size={16}
            className={CHAT_OPERATIONAL_ICON_CLASS}
          />
        </span>
        <h3 className="min-w-0 truncate type-body font-medium text-foreground">
          {m.chat_executionPlan_title()}
        </h3>
        <span className="shrink-0 whitespace-nowrap type-caption text-muted-foreground">
          {m.chat_executionPlan_step_label({
            current: formatInteger(currentStep),
            total: formatInteger(entries.length),
          })}
        </span>
      </div>
      <ol className="min-w-0 border-t border-border py-1" data-testid="execution-plan-entries">
        {entries.map((entry, index) => (
          <li
            key={`${index}-${entry.content}`}
            className={`${OPERATIONAL_ROW_GEOMETRY_TOKENS_CLASS} grid min-h-7 min-w-0 max-w-full grid-cols-[var(--operational-leading-slot-size)_minmax(0,1fr)] items-start gap-2 px-2 py-1.5 type-body ${entry.status === 'in_progress' ? 'bg-muted/30' : ''}`}
            data-plan-status={entry.status}
            aria-current={entry.status === 'in_progress' ? 'step' : undefined}
          >
            <span className={`${CHAT_OPERATIONAL_LEADING_CLASS} mt-0.5`} aria-hidden="true">
              {entry.status === 'completed' ? (
                <IconDefinitionIcon
                  icon={faCheck}
                  size={14}
                  className={CHAT_OPERATIONAL_ICON_CLASS}
                />
              ) : entry.status === 'in_progress' ? (
                <IntentMarkLoader size={12} className={CHAT_OPERATIONAL_ICON_CLASS} />
              ) : (
                <IconDefinitionIcon
                  icon={faCircle}
                  size={7}
                  className="h-2! w-2! shrink-0 opacity-50"
                />
              )}
            </span>
            <span
              className={`min-w-0 whitespace-normal break-words text-foreground${entry.status === 'in_progress' ? ' font-medium' : ''}${entry.status === 'completed' ? ' line-through' : ''}${entry.status !== 'in_progress' ? ' opacity-65' : ''}`}
            >
              <span className="sr-only">{statusLabel(entry.status)}: </span>
              {entry.content}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

export default ExecutionPlanCard;
