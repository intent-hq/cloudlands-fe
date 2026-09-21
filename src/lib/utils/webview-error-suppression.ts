// Matches the throw from Electron's guest-view-manager `getGuestForFrame` when a <webview>
// detaches with a stale guestInstanceId (see error-handler.svelte.ts for the mechanism).
// ErrorEvent messages for uncaught throws carry an "Uncaught Error: " prefix.
const STALE_GUEST_MESSAGE = /^(?:Uncaught )?(?:Error: )?Invalid guestInstanceId: (\d+)$/;

function extractMessage(input: unknown): string | null {
  if (typeof input === 'string') return input;
  if (input instanceof Error) return input.message;
  if (typeof input === 'object' && input !== null) {
    const message = (input as { message?: unknown }).message;
    if (typeof message === 'string') return message;
  }
  return null;
}

export function staleWebviewGuestId(input: unknown): number | null {
  const message = extractMessage(input);
  if (message === null) return null;
  const match = STALE_GUEST_MESSAGE.exec(message.trim());
  return match ? Number(match[1]) : null;
}

export function isStaleWebviewGuestError(input: unknown): boolean {
  return staleWebviewGuestId(input) !== null;
}
