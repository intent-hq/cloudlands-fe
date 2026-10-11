import { Button } from '@/components/ui/button';
import { ToastCloseButton } from '@/components/ui/toast/toast-close-button';
import { ToastGlyph } from '@/components/ui/toast/toast-glyph';
import { m } from '$shared/paraglide/messages.js';
import './notify-error-toast.css';

export interface NotifyErrorToastProps {
  message: string;
  details: string;
  closeToast?: () => void;
  onCloseToast?: () => void;
}

export function NotifyErrorToast({
  message,
  details,
  closeToast,
  onCloseToast,
}: NotifyErrorToastProps) {
  return (
    <div
      className="error-details flex min-w-0 flex-1 items-start gap-2.5"
      data-toast-layout="error-details"
    >
      <ToastGlyph variant="error" />
      <div className="min-w-0 flex-1">
        <p className="toast-title font-medium text-foreground" data-toast-title>
          {message}
        </p>
        <details className="mt-2 min-w-0 text-muted-foreground">
          <summary className="toast-details-summary type-caption inline-flex cursor-pointer items-center gap-2 text-muted-foreground select-none">
            <span className="toast-details-chevron" aria-hidden="true">
              ›
            </span>
            {m.chat_toolCall_technicalDetails_label()}
          </summary>
          <div className="mt-2 rounded-(--radius-medium) bg-muted p-2" data-toast-optional>
            <pre
              className="type-caption whitespace-pre-wrap break-all font-mono"
              data-toast-description
            >
              {details}
            </pre>
          </div>
          <div className="mt-2 flex justify-end gap-2">
            <Button
              variant="ghost"
              size="compact"
              className="toast-detail-copy"
              onClick={async () => {
                await navigator.clipboard.writeText(details);
              }}
            >
              {m.ui_errorToast_copy_label()}
            </Button>
          </div>
        </details>
      </div>
      <ToastCloseButton
        inline
        onClick={() => {
          if (closeToast) closeToast();
          else onCloseToast?.();
        }}
        ariaLabel={m.ui_toast_close_ariaLabel()}
      />
    </div>
  );
}
