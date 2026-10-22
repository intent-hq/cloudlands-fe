import { z } from 'zod';
import type { DevConsoleUpdate, DevConsoleRecord } from '../types/dev-console';

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
};
export interface DevConsoleResponses {
  'dev-console:open': { windowId: number };
  'dev-console:connect': { backendId: string; sessionId: string };
  'dev-console:read': DevConsoleUpdate | null;
  'dev-console:record': DevConsoleRecord | null;
  'dev-console:clear': boolean;
  'dev-console:select': boolean;
}
export type DevConsoleChannel = keyof DevConsoleResponses;
export type DevConsoleRequest<C extends DevConsoleChannel> = z.infer<
  (typeof devConsoleRequests)[C]
>;
