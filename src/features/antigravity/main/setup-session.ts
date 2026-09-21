import { z } from 'zod';
import { JsonRpcClient } from '../../backend/main/json-rpc-client';
import type { BackendConnectionConfig } from '../../backend/main/backend-connection';
import { getOrCreateClientId } from '../../backend/main/client-identity';
import {
  antigravitySetupStatusSchema,
  type AntigravitySetupAction,
  type AntigravitySetupResult,
} from '../../../shared/types/antigravity-setup';

const loginSchema = z.object({ operationId: z.string().max(100), url: z.string().max(16_384) });
const helloSchema = z.object({
  server: z.object({ capabilities: z.object({ antigravitySetup: z.literal(1) }) }),
});

/** One private UDS connection per settings window; no OAuth URLs in IPC/Redux. */
export class AntigravitySetupSession {
  private readonly client: JsonRpcClient;
  private readonly ready: Promise<'ready' | 'updateRequired' | 'connectionLost'>;
  private disposed = false;
  private connected = false;
  private loginOperation: string | null = null;
  private operationId: string | null = null;
  private actionInFlight: Promise<AntigravitySetupResult> | null = null;

  constructor(
    config: BackendConnectionConfig,
    private readonly isCurrent: () => boolean,
    private readonly openExternal: (url: string) => Promise<void>,
  ) {
    this.client = new JsonRpcClient({
      config,
      requestTimeoutMs: 10_000,
      helloParams: async () => ({
        clientId: await getOrCreateClientId(),
        name: 'Intent Antigravity setup', // i18n-ignore (wire client identity)
        capabilities: { antigravitySetup: 1 },
      }),
    });
    this.client.on('error', () => {
      /* Safe result codes below; never log payloads. */
    });
    this.client.on('status', (status: string) => {
      if (status === 'connected') this.connected = true;
      else if (this.connected && status === 'disconnected') this.dispose();
    });
    this.client.registerMethod('providers.setup.openLogin', async (params) => {
      const parsed = loginSchema.safeParse(params);
      if (
        !parsed.success ||
        this.disposed ||
        !this.isCurrent() ||
        parsed.data.operationId !== this.loginOperation
      )
        return { opened: false };
      this.loginOperation = null; // Consume one explicit sign-in click.
      try {
        const url = new URL(parsed.data.url);
        if (
          url.protocol !== 'https:' ||
          url.hostname !== 'accounts.google.com' ||
          url.username ||
          url.password ||
          (url.port && url.port !== '443') ||
          url.hash ||
          !['/o/oauth2/auth', '/o/oauth2/v2/auth'].includes(url.pathname)
        )
          return { opened: false };
        await this.openExternal(parsed.data.url);
        return { opened: true };
      } catch {
        return { opened: false };
      }
    });
    this.ready = this.client.request('client.hello', {}).then(
      (hello) => (helloSchema.safeParse(hello).success ? 'ready' : 'updateRequired'),
      () => {
        this.dispose();
        return 'connectionLost';
      },
    );
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.loginOperation = null;
    this.client.dispose(); // Connection close cancels daemon work.
  }

  async request(
    action: AntigravitySetupAction,
    operationId?: string,
  ): Promise<AntigravitySetupResult> {
    if (!this.isCurrent()) {
      this.dispose();
      return { ok: false, code: 'backendChanged' };
    }
    if (this.disposed) return { ok: false, code: 'connectionLost' };
    const readiness = await this.ready;
    if (readiness !== 'ready') return { ok: false, code: readiness };
    if (
      (action === 'login' || action === 'cancel') &&
      (!operationId || operationId !== this.operationId)
    ) {
      return { ok: false, code: 'invalidOperation' };
    }
    // Repeated Connect clicks share one request. Cancel must never queue behind it.
    if (action === 'start' && this.actionInFlight) return this.actionInFlight;
    if (action === 'login') this.loginOperation = operationId ?? null;
    if (action === 'cancel') this.loginOperation = null;
    const request = this.call(action, operationId);
    if (action === 'start') {
      this.actionInFlight = request;
      try {
        return await request;
      } finally {
        this.actionInFlight = null;
      }
    }
    return request;
  }

  private async call(
    action: AntigravitySetupAction,
    operationId?: string,
  ): Promise<AntigravitySetupResult> {
    try {
      const raw = await this.client.request(`providers.setup.${action}`, {
        providerId: 'antigravity',
        ...(operationId ? { operationId } : {}),
      });
      if (!this.isCurrent() || this.disposed) return { ok: false, code: 'connectionLost' };
      const parsed = antigravitySetupStatusSchema.safeParse(raw);
      if (!parsed.success) return { ok: false, code: 'invalidResponse' };
      this.operationId = parsed.data.operationId;
      if (parsed.data.phase !== 'signingIn') this.loginOperation = null;
      return { ok: true, status: parsed.data };
    } catch {
      this.loginOperation = null;
      return { ok: false, code: 'connectionLost' };
    }
  }
}
