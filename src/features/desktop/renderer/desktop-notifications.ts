import type { DesktopPermissionRequest } from '$shared/types/desktop';
import { m } from '$shared/paraglide/messages.js';

const promptOperations = new Map<string, symbol>();
let notifications: Promise<typeof import('$lib/components/patterns/notify')> | undefined;
const loadNotifications = () => (notifications ??= import('$lib/components/patterns/notify'));

export async function showDesktopPrompt(request: DesktopPermissionRequest): Promise<void> {
  const operation = Symbol();
  promptOperations.set(request.requestId, operation);
  const [{ notify }, { default: component }] = await Promise.all([
    loadNotifications(),
    import('./DesktopConsentToast.svelte'),
  ]);
  if (promptOperations.get(request.requestId) !== operation) return;
  notify.custom(component, {
    id: `desktop-consent:${request.requestId}`,
    duration: Infinity,
    dismissible: false,
    componentProps: {
      workspaceId: request.workspaceId,
      agentId: request.agentId,
      requestId: request.requestId,
    },
  });
}
export async function dismissDesktopPrompt(requestId: string): Promise<void> {
  promptOperations.delete(requestId);
  const { notify } = await loadNotifications();
  notify.dismiss(`desktop-consent:${requestId}`);
}
export async function showDesktopStarted(sessionId: string, computerName: string): Promise<void> {
  const { notify } = await loadNotifications();
  notify.info(m.desktop_start_message({ computer: computerName }), {
    id: `desktop-start:${sessionId}`,
  });
}
export async function showDesktopError(detail: string): Promise<void> {
  const { notify } = await loadNotifications();
  notify.error(m.desktop_consent_failed(), { description: detail });
}
