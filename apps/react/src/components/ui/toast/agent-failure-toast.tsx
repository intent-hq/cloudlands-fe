import { Button } from '@/components/ui/button';
import { CopyButton } from '@/components/ui/copy-button';
import { MicroKeySlotSquare } from '@/features/hardware-console/components/micro-key-slot-square';
import { m } from '$shared/paraglide/messages.js';
import { ToastCloseButton } from './toast-close-button';
import { ToastGlyph } from './toast-glyph';
import './toast-content.css';

export interface AgentFailureToastProps {
  title: string;
  errorSummary: string;
  contextLine?: string;
  retryLabel: string;
  retrying: boolean;
  retryNote?: string;
  keySlot?: number | null;
  loginCommandHint?: string;
  showClaudeDesktopNote?: boolean;
  onRetry: () => void;
  onSwitchTo: () => void;
  onClose: () => void;
}

export function AgentFailureToast({
  title,
  errorSummary,
  contextLine,
  retryLabel,
  retrying,
  retryNote,
  keySlot = null,
  loginCommandHint,
  showClaudeDesktopNote = false,
  onRetry,
  onSwitchTo,
  onClose,
}: AgentFailureToastProps) {
  const metadata = contextLine?.replace(' — ', ' / ');
  return (
    <div
      className="toast-content relative flex w-full min-w-0 items-start gap-2.5 pr-6"
      data-toast-layout="agent-failure"
    >
      <span className="first-line-icon toast-first-line">
        <ToastGlyph variant="error" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-1.5">
          {keySlot != null && (
            <span className="first-line-icon toast-first-line">
              <MicroKeySlotSquare slot={keySlot} />
            </span>
          )}
          <p className="toast-title min-w-0" data-toast-title>
            {title}
          </p>
        </div>
        <p className="toast-description" data-toast-description>
          {errorSummary}
        </p>
        {loginCommandHint && (
          <div className="mt-1.5 flex min-w-0 flex-col gap-1" data-testid="toast-auth-guidance">
            <p className="text-xs text-muted-foreground" data-toast-optional>
              {m.settings_providers_runToLogIn_label()}
            </p>
            <div className="flex items-center gap-1">
              <code
                className="min-w-0 flex-1 truncate rounded bg-muted px-1.5 py-0.5 text-xs"
                title={loginCommandHint}
                data-testid="toast-auth-login-command"
              >
                {loginCommandHint}
              </code>
              <CopyButton text={loginCommandHint} size="xs" />
            </div>
            {showClaudeDesktopNote && (
              <p
                className="text-xs text-muted-foreground break-words"
                data-testid="toast-auth-claude-desktop-note"
                data-toast-description
                data-toast-optional
              >
                {m.settings_providers_claudeDesktopNote_label()}
              </p>
            )}
          </div>
        )}
        {metadata && (
          <p className="toast-metadata min-w-0 truncate" data-toast-optional>
            <span className="toast-metadata-dot" aria-hidden="true" />
            <span className="min-w-0 truncate" title={metadata}>
              {metadata}
            </span>
          </p>
        )}
        {retryNote && (
          <p className="mt-1.5 text-xs text-danger" data-toast-description data-toast-optional>
            {retryNote}
          </p>
        )}
        <div className="toast-actions">
          <Button
            variant="outline"
            size="compact"
            className="toast-action"
            disabled={retrying}
            onClick={onRetry}
          >
            {retrying ? m.ui_agentFailureToast_retrying_label() : retryLabel}
          </Button>
          <Button variant="ghost" size="compact" className="toast-action" onClick={onSwitchTo}>
            {m.agent_failureToast_switchTo_label()}
          </Button>
        </div>
      </div>
      <ToastCloseButton onClick={onClose} ariaLabel={m.ui_agentFailureToast_close_ariaLabel()} />
    </div>
  );
}
