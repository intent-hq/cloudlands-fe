import { Button } from '@/components/ui/button';
import { m } from '$shared/paraglide/messages.js';
import type { AppError } from '$lib/utils/app-error-types';
import { ToastCloseButton } from './toast-close-button';
import { ToastGlyph } from './toast-glyph';
import './toast-content.css';

export interface ErrorToastProps {
  error: AppError;
  onCopy: () => void;
  onDebug?: () => void;
  onRetry?: () => void;
  /** React callback replacing Svelte's closeToast component event. */
  closeToast?: () => void;
  onCloseToast?: () => void;
}

export function ErrorToast({
  error,
  onCopy,
  onDebug,
  onRetry,
  closeToast,
  onCloseToast,
}: ErrorToastProps) {
  return (
    <div
      className="toast-content relative flex w-full min-w-0 items-start gap-2.5 pr-6"
      data-toast-layout="application-error"
    >
      <span className="first-line-icon toast-first-line">
        <ToastGlyph
          variant={error.type === 'warning' || error.type === 'info' ? error.type : 'error'}
        />
      </span>
      <div className="min-w-0 flex-1">
        <p className="toast-title" data-toast-title>
          {error.title}
        </p>
        <p className="toast-description" data-toast-description>
          {error.message}
        </p>
        <div className="toast-actions">
          {error.recoverable && onRetry && (
            <Button variant="outline" size="compact" className="toast-action" onClick={onRetry}>
              {m.ui_errorToast_retry_label()}
            </Button>
          )}
          {onDebug && (
            <Button variant="outline" size="compact" className="toast-action" onClick={onDebug}>
              {m.ui_errorToast_debug_label()}
            </Button>
          )}
          <Button variant="ghost" size="compact" className="toast-action" onClick={onCopy}>
            {m.ui_errorToast_copy_label()}
          </Button>
        </div>
      </div>
      <ToastCloseButton
        onClick={() => {
          onCloseToast?.();
          closeToast?.();
        }}
        ariaLabel={m.ui_errorToast_close_ariaLabel()}
      />
    </div>
  );
}
