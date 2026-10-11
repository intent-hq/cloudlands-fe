import { Button } from '@/components/ui/button';
import { RelativeTime } from '@/components/ui/relative-time';
import { MicroKeySlotSquare } from '@/features/hardware-console/components/micro-key-slot-square';
import { m } from '$shared/paraglide/messages.js';
import { ToastCloseButton } from './toast-close-button';
import { ToastGlyph } from './toast-glyph';
import './toast-content.css';

export interface AgentAttentionToastProps {
  title: string;
  reason: string;
  kind: 'discussion' | 'blocker';
  timestamp?: string;
  keySlot?: number | null;
  onSwitchTo: () => void;
  onClose: () => void;
}

export function AgentAttentionToast({
  title,
  reason,
  kind,
  timestamp,
  keySlot = null,
  onSwitchTo,
  onClose,
}: AgentAttentionToastProps) {
  return (
    <div
      className="toast-content relative flex w-full min-w-0 items-start gap-2.5 pr-6"
      data-toast-layout="agent-attention"
    >
      <span className="first-line-icon toast-first-line">
        <ToastGlyph variant={kind === 'blocker' ? 'warning' : 'discussion'} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-1.5">
          {keySlot != null && (
            <span className="first-line-icon toast-first-line">
              <MicroKeySlotSquare slot={keySlot} />
            </span>
          )}
          <p className="toast-title flex min-w-0 items-baseline">
            <span className="min-w-0 truncate" data-toast-title title={title}>
              {title}
            </span>
            {timestamp && (
              <RelativeTime
                date={timestamp}
                compact
                className="ml-1 shrink-0 whitespace-nowrap text-xs font-normal text-muted-foreground"
              />
            )}
          </p>
        </div>
        <p className="toast-description" data-toast-description>
          {reason}
        </p>
        <div className="toast-actions">
          <Button variant="primary" size="compact" className="toast-action" onClick={onSwitchTo}>
            {m.agent_attentionToast_switchTo_label()}
          </Button>
          <Button variant="ghost" size="compact" className="toast-action" onClick={onClose}>
            {m.agent_attentionToast_later_label()}
          </Button>
        </div>
      </div>
      <ToastCloseButton onClick={onClose} ariaLabel={m.agent_attentionToast_close_ariaLabel()} />
    </div>
  );
}
