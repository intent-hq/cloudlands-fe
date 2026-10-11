import { useEffect, useRef, useState } from 'react';
import { ConfirmRequestView, type ConfirmRequestViewProps } from './confirm-request-view';
import {
  settleConfirmRequest,
  subscribeConfirmRequests,
  type ConfirmRequest,
} from './confirm-service';

function ActiveRequest({
  request,
  onCloseAutoFocus,
}: {
  request: ConfirmRequest;
  onCloseAutoFocus: ConfirmRequestViewProps['onCloseAutoFocus'];
}) {
  const [value, setValue] = useState(
    request.kind === 'prompt' ? (request.options.field.initialValue ?? '') : '',
  );
  const [busy, setBusy] = useState(false);
  const accepting = useRef(false);

  function cancel() {
    if (accepting.current) return;
    settleConfirmRequest(request.id, request.kind === 'confirm' ? false : null);
  }

  async function accept() {
    if (accepting.current) return;
    accepting.current = true;
    setBusy(true);
    try {
      if (request.kind === 'confirm') {
        await request.options.onConfirm?.();
        settleConfirmRequest(request.id, true);
      } else if (request.kind === 'prompt') {
        const result = value.trim();
        if (request.options.field.required && !result) return;
        await request.options.onConfirm?.(result);
        settleConfirmRequest(request.id, result);
      } else {
        settleConfirmRequest(request.id, undefined);
      }
    } finally {
      // Rejections reach FormDialog's localized error and leave the request pending for retry.
      accepting.current = false;
      setBusy(false);
    }
  }

  return (
    <ConfirmRequestView
      request={request}
      value={value}
      onValueChange={setValue}
      busy={busy}
      onAccept={accept}
      onCancel={cancel}
      onCloseAutoFocus={onCloseAutoFocus}
    />
  );
}

/** Mount once per renderer. This is a view adapter over the existing neutral service. */
export function ConfirmHost() {
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  const active = useRef<ConfirmRequest | null>(null);
  useEffect(() => {
    const unsubscribe = subscribeConfirmRequests((next) => {
      active.current = next;
      setRequest(next);
    });
    return () => {
      unsubscribe();
    };
  }, []);

  return (
    request && (
      <ActiveRequest
        key={request.id}
        request={request}
        onCloseAutoFocus={(event) => {
          // An outgoing dialog must not steal focus from the next queued request.
          event.preventDefault();
          if (!active.current && request.returnFocus?.isConnected) request.returnFocus.focus();
        }}
      />
    )
  );
}
