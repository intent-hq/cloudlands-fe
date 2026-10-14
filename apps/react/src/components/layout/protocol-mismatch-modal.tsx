import { useRef, useState } from 'react';
import { ContentDialog } from '@/components/patterns/confirm';
import { Button } from '@/components/ui/button';
import { m } from '$shared/paraglide/messages.js';
import type { ConnectionProtocolMismatchEvent } from '$shared/types/connections';

interface ProtocolMismatchModalProps {
  static?: boolean;
  event: ConnectionProtocolMismatchEvent;
  onOpenLocal?: () => void;
  onContinue?: () => void;
}

export function ProtocolMismatchModal({
  static: staticPosition = false,
  event,
  onOpenLocal,
  onContinue,
}: ProtocolMismatchModalProps) {
  const [open, setOpen] = useState(true);
  const continued = useRef(false);
  function continueAnyway() {
    if (continued.current) return;
    continued.current = true;
    setOpen(false);
    onContinue?.();
  }
  return (
    <ContentDialog
      open={open}
      static={staticPosition}
      title={m.modals_protocolMismatch_title()}
      closeLabel={m.modals_protocolMismatch_close_ariaLabel()}
      onClose={continueAnyway}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenLocal?.()}>
            {m.modals_protocolMismatch_openLocal_label()}
          </Button>
          <Button variant="primary" onClick={continueAnyway}>
            {m.modals_protocolMismatch_continue_label()}
          </Button>
        </>
      }
    >
      <div className="space-y-4 min-w-0">
        <p className="text-sm text-subtle">{m.modals_protocolMismatch_description()}</p>
        <div className="space-y-3 text-xs">
          <div className="flex justify-between gap-2">
            <span className="shrink-0 text-subtle">
              {m.modals_protocolMismatch_connection_label()}
            </span>
            {/* i18n-ignore (host:port, not translatable copy) */}
            <span className="min-w-0 break-all text-right font-mono">
              {event.host}:{event.port}
            </span>
          </div>
          <div className="flex justify-between gap-2">
            <span className="text-subtle">{m.modals_protocolMismatch_localVersion_label()}</span>
            {/* i18n-ignore (protocol version string) */}
            <span className="min-w-0 break-all text-right font-mono">
              {event.localProtocolVersion}
            </span>
          </div>
          <div className="flex justify-between gap-2">
            <span className="text-subtle">{m.modals_protocolMismatch_remoteVersion_label()}</span>
            {/* i18n-ignore (protocol version string) */}
            <span className="min-w-0 break-all text-right font-mono">
              {event.remoteProtocolVersion}
            </span>
          </div>
        </div>
      </div>
    </ContentDialog>
  );
}
