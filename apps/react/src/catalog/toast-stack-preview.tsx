// Source: src/lib/components/ui/toast/toast-stack.preview.svelte.
// i18n-ignore (source preview fixture content)
import { useEffect, useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Toast, AgentAttentionToast, AgentFailureToast, toast } from '@/components/ui/toast';
export const toastStackStates = ['collapsed', 'discussion', 'failure'] as const;
export function ToastStackPreview({ state }: { state: (typeof toastStackStates)[number] }) {
  const scope = useId();
  const toasterId = `mixed-toast-preview-${scope}`;
  const customId = `mixed-toast-custom-${scope}`;
  const successId = `mixed-toast-success-${scope}`;
  const [switches, setSwitches] = useState(0);
  const [retries, setRetries] = useState(0);
  function showDiscussion() {
    const common = { id: customId, toasterId, duration: Infinity };
    const onClose = () => toast.dismiss(customId);
    const onSwitchTo = () => setSwitches((value) => value + 1);
    if (state === 'failure')
      toast.custom(
        () => (
          <AgentFailureToast
            title="Preview agent failed"
            errorSummary="The fixture stopped before completing the task. Retry or return to the agent."
            retryLabel="Retry preview"
            retrying={false}
            onRetry={() => setRetries((value) => value + 1)}
            onSwitchTo={onSwitchTo}
            onClose={onClose}
          />
        ),
        common,
      );
    else
      toast.custom(
        () => (
          <AgentAttentionToast
            title="Preview agent requests a discussion"
            reason="Choose whether the fixture should include more diagnostic details before continuing this demo task."
            kind="discussion"
            onSwitchTo={onSwitchTo}
            onClose={onClose}
          />
        ),
        common,
      );
  }
  function addSuccess() {
    toast.success('Added 1 image to context', { id: successId, toasterId, duration: Infinity });
  }
  useEffect(() => {
    showDiscussion();
    if (state === 'collapsed') addSuccess();
    return () => {
      toast.dismiss(customId);
      toast.dismiss(successId);
    };
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="min-h-96 p-4" data-testid="toast-stack-preview">
      <div className="flex flex-wrap gap-2">
        <Button onClick={showDiscussion}>Show discussion</Button>
        <Button onClick={addSuccess}>Add success</Button>
      </div>
      <output data-testid="toast-switches" className="sr-only">
        {switches}
      </output>
      <output data-testid="toast-retries" className="sr-only">
        {retries}
      </output>
      <Toast toasterId={toasterId} regionId={`mixed-toast-region-${scope}`} />
    </div>
  );
}
