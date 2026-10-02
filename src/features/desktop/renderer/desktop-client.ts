import { z } from 'zod';
import { m } from '$shared/paraglide/messages.js';
import { backendRequest } from '$lib/client/live/backend-transport';
import type {
  DesktopDecision,
  DesktopEvent,
  DesktopSnapshot,
} from '$store/renderer/slices/desktop-control/desktop-control-types';

const id = z.string().min(1);
const scope = { workspaceId: id, agentId: id };
const permission = z.object({ computerId: id, computerName: id, allowed: z.boolean() });
const state = z.discriminatedUnion('status', [
  z.object({ status: z.literal('inactive') }),
  z.object({ status: z.literal('pending_permission'), requestId: id, computerName: id }),
  z.object({ status: z.literal('active'), sessionId: id, computerName: id, hint: z.string() }),
]);
const decision = z.enum(['allow_once', 'allow_future', 'deny']);
const request = z.object({
  ...scope,
  requestId: id,
  agentName: id,
  computerId: id,
  computerName: id,
  expiresAt: z.string().datetime(),
  options: z
    .array(z.object({ id: decision, label: id }))
    .refine(
      (options) => options.map((option) => option.id).join(',') === 'allow_once,allow_future,deny',
    ),
});
const error = z.object({
  code: id,
  detail: z.string(),
  execution: z.enum(['not_started', 'partial', 'unknown']).optional(),
});
const event = z.discriminatedUnion('type', [
  z.object({ id, type: z.literal('desktop:permission-requested'), data: request }),
  z.object({
    id,
    type: z.literal('desktop:permission-changed'),
    data: z.object({ ...scope, permission }),
  }),
  z.object({
    id,
    type: z.literal('desktop:permission-resolved'),
    data: z.object({
      ...scope,
      requestId: id,
      outcome: z.enum(['granted', 'denied', 'expired', 'withdrawn', 'invalidated', 'failed']),
      state,
      error: error.optional(),
    }),
  }),
  z.object({
    id,
    type: z.literal('desktop:session-changed'),
    data: z.object({
      ...scope,
      sessionId: id,
      computerId: id,
      computerName: id,
      status: z.enum(['active', 'ended']),
      reason: z
        .enum([
          'agent_end',
          'user_stop',
          'primary_changed',
          'disconnected',
          'screen_locked',
          'os_permission_lost',
          'lease_expired',
          'agent_terminated',
          'executor_failed',
          'unsupported_environment',
          'outcome_unknown',
        ])
        .optional(),
      reportId: id.optional(),
    }),
  }),
]);
export function parseDesktopEvent(value: unknown): DesktopEvent | undefined {
  const result = event.safeParse(value);
  return result.success ? result.data : undefined;
}
export const desktopClient = {
  async getState(workspaceId: string, agentId: string): Promise<DesktopSnapshot> {
    const hello = await backendRequest<{
      server?: { capabilities?: { desktopControl?: unknown } };
    }>('client.hello', {});
    if (hello.server?.capabilities?.desktopControl !== 1)
      throw new Error(m.desktop_consent_failed());
    // getState also checks the resolved primary's executor capability and authority.
    const snapshot = z
      .object({ state, permission, pending: request.optional() })
      .parse(await backendRequest('desktop.getState', { workspaceId, agentId }));
    if (
      snapshot.pending &&
      (snapshot.pending.workspaceId !== workspaceId ||
        snapshot.pending.agentId !== agentId ||
        snapshot.state.status !== 'pending_permission' ||
        snapshot.state.requestId !== snapshot.pending.requestId)
    )
      throw new Error(m.desktop_consent_failed());
    return snapshot;
  },
  async respond(workspaceId: string, requestId: string, value: DesktopDecision): Promise<void> {
    const result = z.object({ accepted: z.literal(true), requestId: id }).parse(
      await backendRequest('desktop.respondPermission', {
        workspaceId,
        requestId,
        decision: value,
      }),
    );
    if (result.requestId !== requestId) throw new Error(m.desktop_consent_failed());
  },
  async setPermission(workspaceId: string, agentId: string, computerId: string, allowed: boolean) {
    const result = z.object({ permission }).parse(
      await backendRequest('desktop.setPermission', {
        workspaceId,
        agentId,
        computerId,
        allowed,
      }),
    ).permission;
    if (result.computerId !== computerId) throw new Error(m.desktop_consent_failed());
    return result;
  },
};
