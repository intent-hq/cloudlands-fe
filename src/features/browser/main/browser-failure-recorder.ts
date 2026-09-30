/** Bounded, opt-in diagnostics attached before a guest's next document executes. */
import { randomUUID } from 'node:crypto';
import { embeddedBrowserCdp } from './embedded-browser-cdp-service';
import type { ConsoleMessage, NetworkRequest } from './browser-capture-types';

const TEXT_LIMIT = 16_384;
const MAX_REQUESTS = 512;
const MAX_EVENTS = 4096;
const MAX_BYTES = 4 * 1024 * 1024;

/** Do not retain request headers, cookies, POST data, URL credentials or query values. */
export function captureText(value: unknown, limit = TEXT_LIMIT): string {
  if (typeof value !== 'string') return '';
  const text = value
    .slice(0, limit * 2)
    .replace(/(?:https?|wss?):\/\/[^\s<>"']+/gi, (raw) => {
      try {
        const url = new URL(raw);
        return `${url.protocol}//${url.host}${url.pathname}`;
      } catch {
        return '[redacted-url]';
      }
    })
    .replace(
      /((?:["']?)\b(?:[\w-]*(?:token|secret|password|credential|api[-_]?key)|authorization|cookie|set-cookie)(?:["']?)\s*[:=]\s*)(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^\s,;}]+)/gi,
      '$1[redacted]',
    )
    .replace(/(--(?:password|token|secret|api-key)\s+)[^\s]+/gi, '$1[redacted]')
    .replace(/\b(Bearer|Basic)\s+[\w+/=.-]+/gi, '$1 [redacted]');
  return text.length > limit ? `${text.slice(0, limit)}…[truncated]` : text;
}

function stackFrames(stack: any): string | undefined {
  if (!Array.isArray(stack?.callFrames)) return undefined;
  return captureText(
    stack.callFrames
      .slice(0, 20)
      .map(
        (f: any) =>
          `${captureText(f.functionName, 200)} (${captureText(f.url, 2000)}:${Number(f.lineNumber)}:${Number(f.columnNumber)})`,
      )
      .join('\n'),
  );
}

interface CaptureBudget {
  bytes: number;
  events: number;
  dropped: number;
}

/** Shared by every start/stop interval of a session, including snapshot reloads. */
export function captureSink<T>(budget: CaptureBudget, sink: (event: T) => void) {
  return (event: T) => {
    const bytes = Buffer.byteLength(JSON.stringify(event));
    if (budget.events >= MAX_EVENTS || budget.bytes + bytes > MAX_BYTES) {
      budget.dropped++;
      return;
    }
    budget.bytes += bytes;
    budget.events++;
    sink(event);
  };
}

export async function recordBrowserFailures(
  webContentsId: number,
  onConsole: (message: ConsoleMessage) => void,
  onNetwork: (request: NetworkRequest) => void,
): Promise<{ cleanup: () => Promise<void> }> {
  const send = (method: string, params?: Record<string, unknown>) =>
    embeddedBrowserCdp.sendCdpCommand(webContentsId, method, params);
  await embeddedBrowserCdp.ensureAttached(webContentsId);
  const binding = `__intentCapture_${randomUUID().replaceAll('-', '')}`;
  const contexts = new Set<number>();
  const pending = new Map<string, NetworkRequest & { started: number }>();
  const bodies = new Set<Promise<void>>();
  let stopped = false;
  let scriptId: string | undefined;
  let bodyCount = 0;
  const now = () => new Date().toISOString();
  const emitConsole = (message: ConsoleMessage) => {
    if (!stopped) onConsole(message);
  };
  const source = `(() => {
    const key = ${JSON.stringify(binding)};
    if (globalThis[key + '_cleanup']) return;
    const string = value => { try { return String(value).slice(0, 16384); } catch { return '[unserializable]'; } };
    const emit = (kind, value, event) => {
      try { globalThis[key](JSON.stringify({kind, message: string(value?.message ?? value), stack: string(value?.stack ?? ''), url: string(event?.filename ?? location.href), lineNumber: event?.lineno})); } catch {}
    };
    const error = event => emit('window.error', event.error ?? event.message, event);
    const rejection = event => emit('unhandledrejection', event.reason, event);
    addEventListener('error', error);
    addEventListener('unhandledrejection', rejection);
    globalThis[key + '_cleanup'] = () => { removeEventListener('error', error); removeEventListener('unhandledrejection', rejection); delete globalThis[key + '_cleanup']; };
  })()`;
  const unsubscribe = embeddedBrowserCdp.onCdpMessage(webContentsId, (method, params) => {
    if (stopped) return;
    const p = params as any;
    if (method === 'Runtime.executionContextCreated') {
      if (contexts.size < 512 && typeof p.context?.id === 'number') contexts.add(p.context.id);
    } else if (method === 'Runtime.executionContextDestroyed') {
      contexts.delete(p.executionContextId);
    } else if (method === 'Runtime.executionContextsCleared') {
      contexts.clear();
    } else if (method === 'Runtime.bindingCalled' && p.name === binding) {
      if (typeof p.payload !== 'string' || p.payload.length > 65536) return;
      try {
        const event = JSON.parse(p.payload);
        if (!['window.error', 'unhandledrejection'].includes(event.kind)) return;
        emitConsole({
          timestamp: now(),
          level: 'error',
          source: event.kind,
          text: captureText(event.message),
          stack: captureText(event.stack),
          url: captureText(event.url, 2000),
          lineNumber: typeof event.lineNumber === 'number' ? event.lineNumber : undefined,
        });
      } catch {
        /* A guest can call its binding with arbitrary data. */
      }
    } else if (method === 'Runtime.exceptionThrown') {
      const detail = p.exceptionDetails ?? {};
      emitConsole({
        timestamp: now(),
        level: 'error',
        source: 'exception',
        text: captureText(detail.exception?.description ?? detail.text),
        stack: stackFrames(detail.stackTrace),
        url: captureText(detail.url, 2000),
        lineNumber: detail.lineNumber,
      });
    } else if (method === 'Runtime.consoleAPICalled') {
      const level =
        p.type === 'warning'
          ? 'warn'
          : ['log', 'info', 'warn', 'error', 'debug'].includes(p.type)
            ? p.type
            : 'log';
      emitConsole({
        timestamp: now(),
        level,
        text: captureText(
          (Array.isArray(p.args) ? p.args : [])
            .slice(0, 20)
            .map((arg: any) =>
              captureText(
                typeof arg.value === 'string' ? arg.value : (arg.description ?? String(arg.value)),
                2000,
              ),
            )
            .join(' '),
        ),
        stack: stackFrames(p.stackTrace),
      });
    } else if (method === 'Console.messageAdded') {
      const m = p.message ?? {};
      emitConsole({
        timestamp: now(),
        level: m.level === 'warning' ? 'warn' : m.level === 'error' ? 'error' : 'log',
        text: captureText(m.text),
        url: captureText(m.url, 2000),
        lineNumber: m.line,
      });
    } else if (method === 'Network.requestWillBeSent') {
      if (pending.size >= MAX_REQUESTS) {
        const oldest = pending.keys().next().value;
        if (oldest) finish(oldest, 'pending request limit');
      }
      if (pending.has(p.requestId)) finish(p.requestId, 'redirected');
      pending.set(p.requestId, {
        timestamp: Number.isFinite(p.wallTime) ? new Date(p.wallTime * 1000).toISOString() : now(),
        requestId: captureText(p.requestId, 200),
        method: captureText(p.request?.method, 20),
        url: captureText(p.request?.url, 2000),
        initiator: {
          type: captureText(p.initiator?.type, 100),
          stack: stackFrames(p.initiator?.stack),
          url: captureText(p.initiator?.url, 2000),
        },
        started: Date.now(),
      });
    } else if (method === 'Network.responseReceived') {
      const request = pending.get(p.requestId);
      if (request)
        Object.assign(request, {
          status: p.response?.status,
          statusText: captureText(p.response?.statusText, 200),
          mimeType: captureText(p.response?.mimeType, 100),
        });
    } else if (method === 'Network.loadingFailed') {
      const request = pending.get(p.requestId);
      if (request)
        Object.assign(request, {
          failed: true,
          failureReason: captureText(p.errorText),
          bodyUnavailable: 'transport failure',
        });
      finish(p.requestId);
    } else if (method === 'Network.loadingFinished') {
      const request = pending.get(p.requestId);
      if (!request) return;
      request.size = p.encodedDataLength;
      if ((request.status ?? 0) >= 400) {
        request.failed = true;
        if (
          bodyCount >= 32 ||
          bodies.size >= 4 ||
          (request.size ?? 0) > 65536 ||
          !/^(text\/|application\/(json|javascript|problem\+json))/.test(request.mimeType ?? '')
        ) {
          request.bodyUnavailable = 'body type, size or capture limit';
          finish(p.requestId);
          return;
        }
        bodyCount++;
        pending.delete(p.requestId);
        let timer: ReturnType<typeof setTimeout>;
        const job = Promise.race([
          send('Network.getResponseBody', { requestId: p.requestId }),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error('body timeout')), 1000);
          }),
        ])
          .then((result: any) => {
            request.body = captureText(
              result.base64Encoded
                ? Buffer.from(result.body.slice(0, TEXT_LIMIT * 3), 'base64').toString('utf8')
                : result.body,
            );
            request.bodyTruncated = (result.body?.length ?? 0) > TEXT_LIMIT;
          })
          .catch(() => {
            request.bodyUnavailable = 'body unavailable';
          })
          .finally(() => {
            clearTimeout(timer);
            emitRequest(request);
            bodies.delete(job);
          });
        bodies.add(job);
      } else finish(p.requestId);
    }
  });
  function emitRequest(request: NetworkRequest & { started: number }) {
    const { started, ...event } = request;
    onNetwork({ ...event, duration: Date.now() - started });
  }
  function finish(id: string, reason?: string) {
    const request = pending.get(id);
    if (!request) return;
    pending.delete(id);
    if (reason) request.bodyUnavailable = reason;
    emitRequest(request);
  }
  let cleaned = false;
  async function cleanup() {
    if (cleaned) return;
    cleaned = true;
    stopped = true;
    unsubscribe();
    await Promise.allSettled([
      ...(scriptId
        ? [send('Page.removeScriptToEvaluateOnNewDocument', { identifier: scriptId })]
        : []),
      ...[undefined, ...contexts].map((contextId) =>
        send('Runtime.evaluate', {
          expression: `globalThis[${JSON.stringify(binding + '_cleanup')}]?.()`,
          ...(contextId === undefined ? {} : { contextId }),
        }),
      ),
      send('Runtime.removeBinding', { name: binding }),
    ]);
    await Promise.allSettled([...bodies]);
    for (const id of pending.keys()) finish(id, 'capture stopped');
  }
  try {
    await send('Runtime.enable');
    await send('Console.enable');
    await send('Network.enable', { maxTotalBufferSize: 1048576, maxResourceBufferSize: 65536 });
    await send('Page.enable');
    await send('Runtime.addBinding', { name: binding });
    const result = (await send('Page.addScriptToEvaluateOnNewDocument', { source })) as
      { identifier?: string } | undefined;
    scriptId = result?.identifier;
    if (!scriptId) throw new Error('Early document capture script was not installed');
    await send('Runtime.evaluate', { expression: source });
    return { cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
