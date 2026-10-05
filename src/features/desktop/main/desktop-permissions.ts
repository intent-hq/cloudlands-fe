import { z } from 'zod';
import { ReverseRpcHandlerError, type JsonRpcClient } from '../../backend/main/json-rpc-client';
import { getDesktopNativeAdapter } from './desktop-native';
import { desktopFailure } from './desktop-validation';
import { JsonRpcError } from '../../backend/main/json-rpc-errors';

const selection = z
  .object({
    workspaceId: z.string().min(1),
    agentId: z.string().min(1),
    requestId: z.string().min(1),
    decision: z.enum(['allow_once', 'allow_future']),
  })
  .strict();
const pendingState = z.object({
  state: z.object({ status: z.literal('pending_permission'), requestId: z.string() }),
  pending: z.object({
    workspaceId: z.string(),
    agentId: z.string(),
    requestId: z.string(),
    computerId: z.string(),
    expiresAt: z.string().datetime(),
  }),
});
const busy = new WeakSet<JsonRpcClient>();
/** A local Allow click is not OS authorization. Revalidate the daemon's candidate
 * on the sender's existing connection, then ask the same signed execution helper.
 * No lease, input, capture, remembered grant or daemon decision is created here. */
export async function requestDesktopPermissions(
  client: JsonRpcClient,
  value: unknown,
  native = getDesktopNativeAdapter(),
) {
  const p = selection.parse(value);
  const stale = () =>
    new JsonRpcError(
      desktopFailure(
        'desktop-stale-request',
        'This desktop permission request is no longer available',
        'not_started',
      ),
    );
  if (client.getStatus() !== 'connected') throw stale();
  if (busy.has(client))
    throw new JsonRpcError(
      desktopFailure('desktop-busy', 'Desktop permission setup is already pending', 'not_started'),
    );
  busy.add(client);
  let changed = false;
  const changedConnection = () => {
    changed = true;
  };
  client.on('status', changedConnection);
  try {
    const raw = await client.request('desktop.getState', {
      workspaceId: p.workspaceId,
      agentId: p.agentId,
    });
    const parsed = pendingState.safeParse(raw);
    if (!parsed.success) throw stale();
    const { state, pending } = parsed.data;
    const current = () =>
      !changed &&
      client.getStatus() === 'connected' &&
      state.requestId === p.requestId &&
      pending.requestId === p.requestId &&
      pending.workspaceId === p.workspaceId &&
      pending.agentId === p.agentId &&
      Date.parse(pending.expiresAt) > Date.now();
    if (!current()) throw stale();
    const identity = await native.identity();
    if (!current() || pending.computerId !== identity.computerId) throw stale();
    // Windows still uses its normal native interactive-desktop/UIPI preflight.
    if (identity.platform === 'windows') return { platform: 'windows' as const };
    const result = await native.requestPermissions(
      identity.computerId,
      JSON.stringify([p.workspaceId, p.agentId, p.requestId]),
    );
    if (!current()) throw stale();
    return { platform: 'macos' as const, ...result };
  } catch (error) {
    // The existing IPC serializer recognizes JsonRpcError. Preserve native
    // codes/details instead of misclassifying a local refusal as transport loss.
    if (error instanceof ReverseRpcHandlerError) throw new JsonRpcError(error);
    throw error;
  } finally {
    client.removeListener('status', changedConnection);
    busy.delete(client);
  }
}
