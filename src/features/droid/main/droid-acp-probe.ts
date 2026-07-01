/**
 * Droid ACP probe
 *
 * Droid has no `models`/`auth status` CLI subcommand, so readiness is gauged
 * by an ACP handshake: spawn `droid exec --output-format acp` through the
 * daemon (`host.execStream`, PROTOCOL.md §5.14), send `initialize` +
 * `session/new` over stdio JSON-RPC, and inspect the response. A session/new
 * result with a non-empty model list means droid is authenticated and usable.
 * This single probe powers both the availability auth check and dynamic model
 * listing.
 */

import * as os from 'os';
import { Logger } from '../../../shared/logger';
import {
  startAcpChildStream,
  type AcpChildStream,
} from '../../../shared/main/acp-child-stream';

const logger = new Logger('DroidAcpProbe');

export type DroidAcpModel = {
  modelId: string;
  name: string;
  description?: string;
};

export type DroidAcpProbeResult = {
  /** True when initialize + session/new succeeded */
  ok: boolean;
  models: DroidAcpModel[];
  currentModelId?: string;
  /** True when the agent returned an explicit auth-required error */
  authRequired?: boolean;
  error?: string;
};

const PROBE_TIMEOUT_MS = 15000;
const INITIALIZE_TIMEOUT_MS = 5000;
const SESSION_NEW_TIMEOUT_MS = 10000;

/** ACP auth-required JSON-RPC error code (agent-client-protocol spec) */
const ACP_AUTH_REQUIRED_CODE = 401;

function isAuthRequiredError(error: { code?: number; message?: string } | undefined): boolean {
  if (!error) return false;
  if (error.code === ACP_AUTH_REQUIRED_CODE) return true;
  return /auth(entication)?[ _-]?required|not (logged in|authenticated)|unauthorized|please (log ?in|sign ?in)/i.test(
    error.message ?? '',
  );
}

/**
 * Parse models from a droid ACP session/new result.
 * Droid returns `models.availableModels` ([{modelId, name, description}])
 * and `models.currentModelId`.
 */
export function parseDroidModelsFromSessionNew(result: unknown): {
  models: DroidAcpModel[];
  currentModelId?: string;
} {
  const res = result as any;
  const raw = res?.models;
  const candidates: any[] = Array.isArray(raw?.availableModels)
    ? raw.availableModels
    : Array.isArray(raw)
      ? raw
      : [];

  const models: DroidAcpModel[] = [];
  for (const m of candidates) {
    const modelId = (m?.modelId ?? m?.id ?? '').toString().trim();
    if (!modelId) continue;
    models.push({
      modelId,
      name: (m?.name ?? modelId).toString().trim(),
      description: m?.description ? String(m.description) : undefined,
    });
  }

  const currentModelId =
    typeof raw?.currentModelId === 'string'
      ? raw.currentModelId
      : typeof res?.currentModelId === 'string'
        ? res.currentModelId
        : undefined;

  return { models, currentModelId };
}

type JsonRpcMessage = {
  id?: number;
  method?: string;
  result?: unknown;
  error?: { code?: number; message?: string };
};

function createJsonRpcRequester(child: AcpChildStream) {
  let requestId = 0;
  let stdoutBuffer = '';
  const pending = new Map<
    number,
    {
      resolve: (value: JsonRpcMessage) => void;
      reject: (reason: Error) => void;
      timeout: NodeJS.Timeout;
    }
  >();

  const onStdoutChunk = (data: Buffer) => {
    stdoutBuffer += data.toString();
    let newlineIndex = stdoutBuffer.indexOf('\n');

    while (newlineIndex !== -1) {
      const line = stdoutBuffer.slice(0, newlineIndex).trim();
      stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
      newlineIndex = stdoutBuffer.indexOf('\n');

      if (!line) continue;

      try {
        const msg = JSON.parse(line) as JsonRpcMessage;
        // Only treat messages without a `method` as responses — agent-initiated
        // requests/notifications carry a `method` and must not settle our calls.
        if (msg && typeof msg === 'object' && msg.method === undefined && typeof msg.id === 'number') {
          const request = pending.get(msg.id);
          if (request) {
            clearTimeout(request.timeout);
            pending.delete(msg.id);
            request.resolve(msg);
          }
        }
      } catch {
        logger.debug('Droid ACP emitted non-JSON stdout', { line });
      }
    }
  };

  child.stdout?.on('data', onStdoutChunk as any);

  // Handle stdin errors (e.g. async EPIPE when droid exits mid-write). Pending
  // requests are settled by the probe's exit handler or per-request timeouts.
  const onStdinError = (error: Error) => {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes('EPIPE')) {
      // Benign: droid exited before consuming the request
      logger.debug('Droid ACP stdin EPIPE (process exited before consuming input)');
    } else {
      logger.warn('Droid ACP stdin error', { error: msg });
    }
  };
  child.stdin?.on('error', onStdinError);

  return {
    sendRequest(method: string, params?: unknown, timeoutMs: number = 8000) {
      return new Promise<JsonRpcMessage>((resolveRequest, rejectRequest) => {
        const id = ++requestId;
        const payload = { jsonrpc: '2.0', id, method, params };
        const timeout = setTimeout(() => {
          pending.delete(id);
          rejectRequest(new Error(`Droid ACP request timed out: ${method}`));
        }, timeoutMs);

        pending.set(id, { resolve: resolveRequest, reject: rejectRequest, timeout });

        try {
          child.stdin?.write(`${JSON.stringify(payload)}\n`);
        } catch (e) {
          clearTimeout(timeout);
          pending.delete(id);
          rejectRequest(e as Error);
        }
      });
    },
    dispose() {
      child.stdout?.off('data', onStdoutChunk as any);
      child.stdin?.off('error', onStdinError);
      for (const [id, request] of pending) {
        clearTimeout(request.timeout);
        pending.delete(id);
      }
    },
  };
}

/**
 * Probe droid's ACP interface: initialize + session/new.
 *
 * - `ok: true` with models — droid is authenticated and usable
 * - `authRequired: true` — droid returned an explicit auth-required error
 * - otherwise (`ok: false`, no authRequired) — spawn failure/timeout, unknown state
 */
export async function probeDroidAcp(
  cliPath: string,
  options: { args?: string[]; timeoutMs?: number; cwd?: string } = {},
): Promise<DroidAcpProbeResult> {
  const timeoutMs = options.timeoutMs ?? PROBE_TIMEOUT_MS;
  const cwd = options.cwd ?? os.homedir();
  const args = options.args ?? ['exec', '--output-format', 'acp'];

  // AUDIT-R1c: the droid ACP probe now spawns the CLI through the daemon
  // (`host.execStream`, PROTOCOL.md §5.14). The daemon owns the process tree
  // and honours cancel/timeout; the FE just drives the stdio JSON-RPC
  // handshake through the returned handle.
  let child: AcpChildStream;
  try {
    child = await startAcpChildStream(cliPath, {
      args,
      timeoutMs: timeoutMs + 2000,
    });
  } catch (e) {
    return { ok: false, models: [], error: (e as Error).message };
  }

  const rpc = createJsonRpcRequester(child);

  return await new Promise<DroidAcpProbeResult>((resolve) => {
    let done = false;
    let stderrTail = '';

    const finish = (result: DroidAcpProbeResult) => {
      if (done) return;
      done = true;
      rpc.dispose();
      child.kill();
      resolve(result);
    };

    const timeoutId = setTimeout(() => {
      logger.warn('Timed out waiting for droid ACP probe');
      finish({ ok: false, models: [], error: 'Droid ACP probe timed out' });
    }, timeoutMs);

    child.stderr?.on('data', (data: Buffer) => {
      const text = data.toString();
      stderrTail = (stderrTail + text).slice(-2000);
      const trimmed = text.trim();
      if (trimmed) {
        logger.debug('Droid ACP stderr', { stderr: trimmed });
      }
    });

    child.on('error', (error) => {
      clearTimeout(timeoutId);
      finish({ ok: false, models: [], error: error.message });
    });

    child.on('exit', (code) => {
      clearTimeout(timeoutId);
      finish({
        ok: false,
        models: [],
        authRequired: isAuthRequiredError({ message: stderrTail }) || undefined,
        error: `Droid exited before responding (code ${code})`,
      });
    });

    (async () => {
      try {
        const initResponse = await rpc.sendRequest(
          'initialize',
          {
            protocolVersion: 1,
            clientInfo: { name: 'Intent', version: '1.0.0' },
            clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } },
          },
          INITIALIZE_TIMEOUT_MS,
        );
        if (initResponse.error) {
          clearTimeout(timeoutId);
          finish({
            ok: false,
            models: [],
            authRequired: isAuthRequiredError(initResponse.error) || undefined,
            error: initResponse.error.message,
          });
          return;
        }

        const sessionResponse = await rpc.sendRequest(
          'session/new',
          { cwd, mcpServers: [] },
          SESSION_NEW_TIMEOUT_MS,
        );
        clearTimeout(timeoutId);
        if (sessionResponse.error) {
          finish({
            ok: false,
            models: [],
            authRequired: isAuthRequiredError(sessionResponse.error) || undefined,
            error: sessionResponse.error.message,
          });
          return;
        }

        const { models, currentModelId } = parseDroidModelsFromSessionNew(sessionResponse.result);
        if (models.length === 0) {
          logger.debug('No models found in droid ACP session/new response');
        }
        finish({ ok: true, models, currentModelId });
      } catch (e) {
        clearTimeout(timeoutId);
        finish({ ok: false, models: [], error: (e as Error).message });
      }
    })();
  });
}

