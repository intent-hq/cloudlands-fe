import { z } from 'zod';
import type { DevConsoleUpdate, DevConsoleRecord } from '../types/dev-console';
import type { LinkCaptureStatus, LinkTrafficRead, LinkTrafficRecord } from '../types/daemon-links';

const session = z.object({ sessionId: z.string().min(1).max(128) }).strict();
export const devConsoleRequests = {
  'dev-console:open': z.object({}).strict(),
  'dev-console:connect': z.object({}).strict(),
  'dev-console:read': session.extend({ afterRevision: z.number().int().min(-1) }),
  'dev-console:record': session.extend({ recordId: z.string().min(1).max(256) }),
  'dev-console:clear': session,
  'dev-console:select': session.extend({
    selection: z
      .object({
        direction: z.enum(['outbound', 'inbound']),
        kind: z.enum(['request', 'notification']),
        method: z.string().min(1).max(4096),
      })
      .strict(),
    enabled: z.boolean(),
  }),
  'dev-console:links-status': session,
  'dev-console:links-start': session,
  'dev-console:links-stop': session,
  'dev-console:links-read': session.extend({
    afterSeq: z.number().int().min(-1).max(Number.MAX_SAFE_INTEGER),
  }),
  'dev-console:links-record': session.extend({
    seq: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    /** The selected row's `captureStartedAt`. */
    startedAt: z.string().max(64),
  }),
};
export interface DevConsoleResponses {
  'dev-console:open': { windowId: number };
  'dev-console:connect': { backendId: string; sessionId: string };
  'dev-console:read': DevConsoleUpdate | null;
  'dev-console:record': DevConsoleRecord | null;
  'dev-console:clear': boolean;
  'dev-console:select': boolean;
  /** Whether the console's daemon advertises `remoteLinkTraffic: 1`; no daemon call. */
  'dev-console:links-status': { supported: boolean };
  'dev-console:links-start': LinkCaptureStatus;
  'dev-console:links-stop': LinkCaptureStatus;
  'dev-console:links-read': LinkTrafficRead;
  'dev-console:links-record': LinkTrafficRecord | null;
}
export type DevConsoleChannel = keyof DevConsoleResponses;
export type DevConsoleRequest<C extends DevConsoleChannel> = z.infer<
  (typeof devConsoleRequests)[C]
>;
