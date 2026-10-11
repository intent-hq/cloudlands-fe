// Source: src/lib/components/layout/AgentMemoryBreakdownDialog.svelte.
import { useLayoutEffect, useRef, useState } from 'react';
import { WarningIcon } from '@phosphor-icons/react';
import { FormDialog } from '@/components/patterns/confirm';
import { ListView } from '@/components/patterns/collection';
import {
  Accordion,
  AccordionContent,
  AccordionHeader,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Tooltip } from '@/components/ui/tooltip';
import {
  selectAgentMemoryUsage,
  selectAgentMemoryUsageError,
} from '@/store/daemon-health/agent-memory-selectors';
import { observeOverflow } from '$lib/actions/observe-overflow';
import { formatDateTime, formatNumber } from '$lib/i18n/format';
import { formatMemory } from '$lib/utils/daemon-status-format';
import { m } from '$shared/paraglide/messages.js';

export interface AgentMemoryBreakdownDialogProps {
  /** Called for every dismissal: Close button, Escape, X, backdrop. */
  onClose: () => void;
}

function formatProcessCount(count: number): string {
  return count === 1
    ? m.layout_agentMemoryBreakdown_processes_one({ count: formatNumber(count) })
    : m.layout_agentMemoryBreakdown_processes_many({ count: formatNumber(count) });
}

function ProcessCommand({ command }: { command: string }) {
  const text = useRef<HTMLSpanElement>(null);
  const [overflow, setOverflow] = useState(false);
  useLayoutEffect(() => {
    if (!text.current) return;
    const observer = observeOverflow(text.current, setOverflow);
    return () => observer?.destroy?.();
  }, []);

  return (
    <Tooltip
      disabled={!overflow}
      side="top"
      className="min-w-0 flex-1"
      contentClass="max-w-xl break-all"
      content={<span className="select-text font-mono">{command}</span>}
    >
      <span ref={text} className="block min-w-0 w-full truncate select-text font-mono">
        {command}
      </span>
    </Tooltip>
  );
}

/**
 * Mounted only while open. The parent owns the canonical
 * agentMemoryBreakdownOpened / agentMemoryBreakdownClosed dispatches.
 * Agent and process order come directly from the daemon sample.
 */
export function AgentMemoryBreakdownDialog({ onClose }: AgentMemoryBreakdownDialogProps) {
  const usage = selectAgentMemoryUsage().value;
  const error = selectAgentMemoryUsageError().value;
  const [open, setOpen] = useState(true);
  const [expandedAgentIds, setExpandedAgentIds] = useState<string[]>([]);

  return (
    <FormDialog
      open={open}
      onOpenChange={setOpen}
      title={m.layout_agentMemoryBreakdown_title()}
      description={m.layout_agentMemoryBreakdown_description()}
      submitLabel={m.layout_agentMemoryBreakdown_close_label()}
      submitVariant="outline"
      showCancel={false}
      className="max-w-2xl"
      onSubmit={onClose}
      onCancel={onClose}
    >
      {usage ? (
        <>
          {error && (
            <output className="flex items-center gap-1.5 type-caption text-warning-ink">
              <WarningIcon aria-hidden size="1em" />
              {m.layout_agentMemoryBreakdown_refreshError_label()}
            </output>
          )}
          <div className="flex flex-wrap justify-between gap-x-4 gap-y-1 type-caption text-muted-foreground">
            <span className="shrink-0 whitespace-nowrap">
              {m.layout_agentMemoryBreakdown_total_label()}{' '}
              <span className="tabular-nums text-foreground">
                {usage.totalBytes === null ? '—' : formatMemory(usage.totalBytes)}
              </span>
            </span>
            {usage.sampledAt && (
              <span>
                {m.layout_agentMemoryBreakdown_sampledAt_label({
                  time: formatDateTime(usage.sampledAt),
                })}
              </span>
            )}
          </div>
          {usage.agents.length === 0 ? (
            <p className="type-body text-muted-foreground py-4 text-center">
              {m.layout_agentMemoryBreakdown_empty_label()}
            </p>
          ) : (
            <Accordion
              type="multiple"
              value={expandedAgentIds}
              onValueChange={setExpandedAgentIds}
              className="max-h-[60vh] overflow-y-auto"
            >
              {usage.agents.map((agent) => (
                <AccordionItem
                  key={agent.agentId}
                  value={agent.agentId}
                  className="border-b border-border last:border-b-0"
                >
                  <AccordionHeader>
                    <AccordionTrigger>
                      <span className="flex items-center justify-between gap-3 min-w-0">
                        <span className="flex min-w-0 flex-col">
                          <span className="truncate text-foreground">{agent.agentName}</span>
                          <span className="truncate">
                            {m.layout_agentMemoryBreakdown_workspace_label({
                              workspace: agent.workspaceId,
                            })}{' '}
                            · {agent.provider}
                            {agent.model ? `/${agent.model}` : ''}
                          </span>
                        </span>
                        <span className="flex shrink-0 flex-col items-end tabular-nums">
                          <span className="text-foreground">{formatMemory(agent.memoryBytes)}</span>
                          <span>{formatProcessCount(agent.processCount)}</span>
                        </span>
                      </span>
                    </AccordionTrigger>
                  </AccordionHeader>
                  <AccordionContent>
                    <ListView
                      items={agent.processes}
                      getKey={(proc) => proc.pid}
                      getText={(proc) => proc.name}
                      virtualize={false}
                      ariaLabel={m.layout_agentMemoryBreakdown_processList_ariaLabel({
                        agent: agent.agentName,
                      })}
                      row={({ item: proc }) => (
                        <div className="flex items-baseline gap-2 min-w-0 px-1 py-0.5">
                          <span className="shrink-0 tabular-nums">
                            {m.layout_agentMemoryBreakdown_pid_label({ pid: String(proc.pid) })}
                          </span>
                          <span className="shrink-0 text-foreground">{proc.name}</span>
                          <ProcessCommand command={proc.cmdline} />
                          <span className="ml-auto shrink-0 tabular-nums text-foreground">
                            {formatMemory(proc.memoryBytes)}
                          </span>
                        </div>
                      )}
                    />
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          )}
        </>
      ) : error ? (
        <p className="type-body text-danger py-4 text-center">
          {m.layout_agentMemoryBreakdown_error_label()}
        </p>
      ) : (
        <p className="type-body text-muted-foreground py-4 text-center" aria-live="polite">
          {m.layout_agentMemoryBreakdown_loading_label()}
        </p>
      )}
    </FormDialog>
  );
}
