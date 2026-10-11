// Source: src/lib/components/ui/toast/toast-header.preview.svelte.
// i18n-ignore (source preview fixture content)
import { useEffect, useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Toast,
  ToastUndoAction,
  UpdateToast,
  toast,
  type UpdateToastPreviewState,
} from '@/components/ui/toast';
import { notify } from '@/components/patterns/notify';
import { m } from '$shared/paraglide/messages.js';

export const toastHeaderStates = [
  'downloaded',
  'available',
  'downloading',
  'error',
  'standard',
  'plain',
  'undo',
  'stacked',
  'multiline-warning',
  'details',
  'multiline-details',
] as const;
export function ToastHeaderPreview({ state }: { state: (typeof toastHeaderStates)[number] }) {
  const scope = useId();
  const toasterId = `toast-header-preview-${scope}`;
  const id = `toast-header-fixture-${scope}`;
  const rearId = `toast-header-rear-${scope}`;
  const [actions, setActions] = useState(0);
  const [dismissals, setDismissals] = useState(0);
  function show() {
    const options = { id, toasterId, duration: Infinity };
    const action = () => setActions((value) => value + 1);
    const dismiss = () => setDismissals((value) => value + 1);
    const close = () => {
      dismiss();
      toast.dismiss(id);
    };
    const status = state === 'stacked' ? 'plain' : state;
    if (status === 'multiline-warning')
      notify.warning(m.daemonStatus_versionMismatch_warning({ version: ' (fixture)' }), options);
    else if (status === 'details' || status === 'multiline-details')
      notify.error(
        {
          message:
            status === 'details'
              ? 'Request failed'
              : 'Request failed while loading the fixture workspace and its recent activity',
          details: 'Fixture diagnostic only\nRequest: preview-load\nResult: unavailable',
        },
        options,
      );
    else if (status === 'undo')
      toast.warning('Workspace archived', { ...options, action: <ToastUndoAction /> });
    else if (status === 'standard' || status === 'plain') {
      const showStandard = status === 'plain' ? toast : toast.success;
      showStandard('Workspace saved', {
        ...options,
        description:
          'Your workspace changes are safe. Continue working while the fixture stays open.',
        action: { label: 'Review', onClick: action },
        cancel: status === 'plain' ? { label: 'Later', onClick: dismiss } : undefined,
        onDismiss: dismiss,
      });
    } else {
      const previewState: UpdateToastPreviewState = {
        status,
        updateInfo: {
          version: '4.2.0-alpha.20260916',
          releaseDate: '2026-09-16',
          releaseNotes: 'Fixture only',
        },
        progress: { percent: 62, bytesPerSecond: 2400000, transferred: 62000000, total: 95600000 },
        remainingSeconds: 14,
        error: 'The fixture could not reach the update server. Please try again later.',
        onInstall: action,
        onDownload: action,
      };
      toast.custom(
        () => (
          <UpdateToast
            previewState={previewState}
            onDismiss={close}
            onAutoDismiss={() => undefined}
          />
        ),
        options,
      );
    }
  }
  useEffect(() => {
    if (state === 'stacked')
      toast.info('Earlier notification', {
        id: rearId,
        toasterId,
        duration: Infinity,
        description:
          'This longer notification must hide its copy while collapsed behind the header fixture.',
      });
    show();
    return () => {
      toast.dismiss(id);
      toast.dismiss(rearId);
    };
    // One source mount per scene. Callbacks retain only stable React setters and ids.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="min-h-64 p-4" data-testid="toast-header-preview">
      <Button onClick={show}>Show fixture toast</Button>
      <output data-testid="toast-header-actions" className="sr-only">
        {actions}
      </output>
      <output data-testid="toast-header-dismissals" className="sr-only">
        {dismissals}
      </output>
      <Toast toasterId={toasterId} regionId={`toast-header-region-${scope}`} />
    </div>
  );
}
