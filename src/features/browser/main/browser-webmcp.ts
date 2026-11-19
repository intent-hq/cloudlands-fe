/**
 * WebMCP (https://webmachinelearning.github.io/webmcp/) bridge for the agent
 * browser: pages register tools with `document.modelContext.registerTool()`,
 * and the `listTools` / `callTool` actions read and run them through CDP.
 *
 * Chromium exposes the registry to page script as `getTools()` (tools carry
 * `inputSchema` as a JSON string) and `executeTool(tool, inputJson)`, which
 * resolves to the tool's JSON-encoded result or null.
 */

interface WebMcpTool {
  name: string;
  title?: string;
  description: string;
  inputSchema?: unknown;
  annotations?: Record<string, unknown>;
  origin?: string;
}

type WebMcpListOutcome =
  { available: true; tools: WebMcpTool[] } | { available: false; secureContext: boolean };

type WebMcpCallOutcome = { ok: true; output: unknown } | { ok: false; error: string };

const RESOLVE_CONTEXT = 'const mc = document.modelContext ?? navigator.modelContext;';

export const LIST_TOOLS_EXPRESSION = `(async () => {
  ${RESOLVE_CONTEXT}
  if (!mc || typeof mc.getTools !== 'function') return { available: false, secureContext: isSecureContext };
  const tools = await mc.getTools();
  return {
    available: true,
    tools: tools.map((t) => ({
      name: t.name,
      title: t.title || undefined,
      description: t.description,
      inputSchema: t.inputSchema,
      annotations: t.annotations,
      origin: t.origin,
    })),
  };
})()`;

export function callToolExpression(name: string, input: unknown): string {
  return `(async () => {
  ${RESOLVE_CONTEXT}
  if (!mc || typeof mc.executeTool !== 'function') return { kind: 'unavailable', secureContext: isSecureContext };
  const name = ${JSON.stringify(name)};
  const tools = await mc.getTools();
  const matches = tools.filter((t) => t.name === name);
  const tool = matches.find((t) => t.window === window) ?? matches[0];
  if (!tool) return { kind: 'not-found', names: tools.map((t) => t.name) };
  try {
    return { kind: 'ok', output: await mc.executeTool(tool, ${JSON.stringify(JSON.stringify(input ?? {}))}) };
  } catch (error) {
    return { kind: 'failed', message: String(error?.name ? error.name + ': ' + error.message : error) };
  }
})()`;
}

function parseJson(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function unavailableMessage(secureContext: boolean): string {
  return secureContext
    ? 'This page does not expose WebMCP (document.modelContext is missing).' // i18n-ignore (agent-facing protocol error, not user-facing)
    : 'WebMCP needs a secure context: load the page over https:// or a localhost URL.'; // i18n-ignore (agent-facing protocol error, not user-facing)
}

export function parseListOutcome(raw: unknown): WebMcpListOutcome {
  const value = (raw ?? {}) as {
    available?: boolean;
    secureContext?: boolean;
    tools?: WebMcpTool[];
  };
  if (!value.available) return { available: false, secureContext: value.secureContext === true };
  return {
    available: true,
    tools: (value.tools ?? []).map((tool) => ({
      ...tool,
      inputSchema: parseJson(tool.inputSchema),
    })),
  };
}

export function listWarning(outcome: WebMcpListOutcome): string | undefined {
  return outcome.available ? undefined : unavailableMessage(outcome.secureContext);
}

export function parseCallOutcome(raw: unknown, name: string): WebMcpCallOutcome {
  const value = (raw ?? {}) as {
    kind?: string;
    secureContext?: boolean;
    names?: string[];
    output?: unknown;
    message?: string;
  };
  switch (value.kind) {
    case 'ok':
      return { ok: true, output: parseJson(value.output) };
    case 'not-found':
      return {
        ok: false,
        // i18n-ignore (agent-facing protocol error, not user-facing)
        error: `No WebMCP tool named "${name}" on this page. Available: ${value.names?.length ? value.names.join(', ') : 'none'}. Use { action: "listTools" } to see each tool's inputSchema.`,
      };
    case 'failed':
      return {
        ok: false,
        // i18n-ignore (agent-facing protocol error, not user-facing)
        error: `WebMCP tool "${name}" failed: ${value.message ?? 'unknown error'}`,
      };
    default:
      return { ok: false, error: unavailableMessage(value.secureContext === true) };
  }
}
