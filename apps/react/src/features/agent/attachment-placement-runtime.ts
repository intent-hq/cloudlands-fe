import { backend } from '@/features/backend/backend-transport';
import { createBackendAttachmentPlacement } from '$lib/client/live/backend-attachment-placement';
import { supportsIdempotentPlacementProtocol } from '$lib/client/live/attachment-upload';
import { m } from '$shared/paraglide/messages.js';
const attachmentPlacement = createBackendAttachmentPlacement(backend.backendRequest);
export async function placementApi(current: () => boolean) {
  if (!current()) throw new Error(m.workspace_client_accessChanged_error());
  // React does not run the source health dashboard poller. Read the current
  // daemon contract at this mutation boundary rather than assuming a version.
  const status = await backend.backendRequest<{ protocolVersion?: string }>('system.status');
  if (!current()) throw new Error(m.workspace_client_accessChanged_error());
  return {
    ...attachmentPlacement,
    mintIdempotencyKey: (existing?: string) =>
      supportsIdempotentPlacementProtocol(status.protocolVersion)
        ? (existing ?? crypto.randomUUID())
        : undefined,
  };
}
