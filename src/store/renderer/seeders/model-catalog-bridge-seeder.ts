/**
 * Model catalog bridge — routes the 7 per-provider `*:get-models` channels
 * (auggie / claude-code / codex / cortex / droid / opencode / pi) to the
 * daemon host surface (`host.checkAuggie` / `host.findBinary` / `host.exec`,
 * PROTOCOL §5.14) or to the same static catalogs the retired main-process
 * handlers served. These channels were recorded as known-unbridged audit debt
 * (they escaped the scanner through the per-provider `invokeModelChannel`
 * passthrough wrappers), which left ModelPicker unable to list ANY models —
 * so the selected model never moved off the `opus4.7` UI default.
 *
 * Envelope semantics mirror each provider's `features/<p>/main/<p>.ipc.ts`
 * handler; callers (the `get<Provider>Models` clients) throw on
 * `success:false` or empty `data`, folding `error`/`warning` into the thrown
 * message, so every branch below is an honest terminal state:
 *  - auggie:      `auggie model list --json` on the daemon host (plain-text
 *                 fallback), parsed with the same parser rules as main.
 *  - opencode:    `opencode models` on the daemon host, one `provider/model`
 *                 per line.
 *  - codex:       static catalog (`getCodexModelList`) — the dynamic probe
 *                 needs the codex app-server transport, which has no
 *                 renderer/daemon arm; main falls back to the same list.
 *  - claude-code / pi: single "Default (<Provider>)" catalog entry when the
 *                 CLI is installed — the ACP model probe is main-only.
 *  - cortex:      feature-code gated; the renderer cannot verify the gate, so
 *                 default-deny (`Cortex not available`) like the status bridge.
 *  - droid:       models only exist via the ACP stdio probe (no static
 *                 catalog); empty data + warning surfaces that honestly.
 *
 * Handlers are registered at import time (host-bridge-seeder idiom).
 */
import { registerMockIpcHandler } from "$shared/ipc-mock-router";
import {
  AUGGIE_CHANNELS,
  CLAUDE_CODE_CHANNELS,
  CODEX_CHANNELS,
  CORTEX_CHANNELS,
  DROID_CHANNELS,
  OPENCODE_CHANNELS,
  PI_CHANNELS,
} from "$shared/ipc/channels";
import { getCodexModelList } from "$shared/config/open-ai-codex-models";
import { backendRequest } from "$lib/client/live/backend-transport";

/** Daemon `host.checkAuggie` / `host.findBinary` result shape. */
interface HostCheckResult {
  available: boolean;
  version?: string;
  path?: string;
}

/** Daemon `host.exec` result shape (PROTOCOL §5.14). */
interface HostExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut?: boolean;
}

/** Model shape shared by every provider's get-models envelope. */
interface ProviderModelEntry {
  value: string;
  label: string;
  description?: string;
  modelGroupPriority?: number;
  isLegacyModel?: boolean;
  costTier?: number;
  badges?: Array<{ color: string; label: string; variant?: string }>;
  effortLevels?: string[];
  isDefault?: boolean;
  priority?: number;
}

type GetModelsEnvelope = {
  success: boolean;
  data?: ProviderModelEntry[];
  warning?: string;
  error?: string;
};

/** `auggie model list` can be slow on cold CLI start (main used exec default). */
const MODEL_LIST_TIMEOUT_MS = 30000;
/** `opencode models` timeout — matches the main handler's exec budget. */
const OPENCODE_MODELS_TIMEOUT_MS = 10000;

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** One-shot exec on the daemon host (argv-based, no shell — PROTOCOL §5.14). */
async function hostExec(
  command: string,
  args: string[],
  timeoutMs: number,
): Promise<HostExecResult> {
  return await backendRequest<HostExecResult>("host.exec", { command, args, timeoutMs });
}

/** Resolve one binary on the daemon host; RPC failure folds to not-found. */
async function findBinary(name: string): Promise<HostCheckResult> {
  try {
    const found = await backendRequest<HostCheckResult>("host.findBinary", { name });
    return found ?? { available: false };
  } catch {
    return { available: false };
  }
}

// ---------------------------------------------------------------------------
// Auggie model-list parsing (ported verbatim from features/auggie/main/
// auggie.ipc.ts — parseModelListJson / parseModelListOutput / sort+filter).
// ---------------------------------------------------------------------------

/** Parse `auggie model list --json` output; null when not parseable. */
function parseModelListJson(stdout: string): ProviderModelEntry[] | null {
  try {
    const parsed = JSON.parse(stdout);
    if (!parsed || !Array.isArray(parsed.models)) return null;
    return parsed.models
      .filter(
        (m: Record<string, unknown>) =>
          typeof m.shortName === "string" && typeof m.displayName === "string",
      )
      .map((m: Record<string, unknown>) => ({
        value: m.shortName as string,
        label: m.displayName as string,
        ...(m.description ? { description: m.description as string } : {}),
        ...(m.modelGroupPriority != null
          ? { modelGroupPriority: m.modelGroupPriority as number }
          : {}),
        ...(m.isLegacyModel ? { isLegacyModel: true } : {}),
        ...(m.costTier != null ? { costTier: m.costTier as number } : {}),
        ...(Array.isArray(m.badges) && m.badges.length > 0
          ? { badges: m.badges as ProviderModelEntry["badges"] }
          : {}),
        ...(Array.isArray(m.effortLevels) && m.effortLevels.length > 0
          ? { effortLevels: m.effortLevels as string[] }
          : {}),
        ...(m.isDefault ? { isDefault: true } : {}),
        ...(m.priority != null ? { priority: m.priority as number } : {}),
      }));
  } catch {
    return null;
  }
}

/**
 * Parse plain `auggie model list` output:
 *   Available models:
 *    - Display Name [model-id]
 *        Description text on next line
 */
function parseModelListOutput(stdout: string): ProviderModelEntry[] {
  const models: ProviderModelEntry[] = [];
  const lines = stdout.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const trimmedLine = lines[i].trim();
    if (!trimmedLine || trimmedLine.startsWith("Available models")) continue;
    const modelMatch = trimmedLine.match(/^-\s+(.+?)\s*\[([^\]]+)\]/);
    if (!modelMatch) continue;
    const label = modelMatch[1].trim();
    const value = modelMatch[2].trim();
    let description: string | undefined;
    if (i + 1 < lines.length) {
      const nextLine = lines[i + 1].trim();
      if (nextLine && !nextLine.startsWith("-") && !nextLine.startsWith("Available")) {
        description = nextLine;
        i++;
      }
    }
    models.push({ value, label, ...(description ? { description } : {}) });
  }
  return models;
}

/** Drop legacy models and apply main's group/priority/label ordering. */
function filterAndSortAuggieModels(models: ProviderModelEntry[]): ProviderModelEntry[] {
  return models
    .filter((m) => !m.isLegacyModel)
    .sort((a, b) => {
      const aGroup = a.modelGroupPriority ?? 999;
      const bGroup = b.modelGroupPriority ?? 999;
      if (aGroup !== bGroup) return aGroup - bGroup;
      const aPriority = a.priority ?? 999;
      const bPriority = b.priority ?? 999;
      if (aPriority !== bPriority) return aPriority - bPriority;
      return a.label.localeCompare(b.label);
    });
}

// ---------------------------------------------------------------------------
// auggie:get-models — live CLI catalog via the daemon host
// ---------------------------------------------------------------------------

registerMockIpcHandler(AUGGIE_CHANNELS.GET_MODELS, async (): Promise<GetModelsEnvelope> => {
  try {
    const check = await backendRequest<HostCheckResult>("host.checkAuggie");
    if (check?.available !== true || !check.path) {
      return { success: false, error: "Auggie CLI not found. Please install auggie first." };
    }

    let models: ProviderModelEntry[] | null = null;
    try {
      const json = await hostExec(check.path, ["model", "list", "--json"], MODEL_LIST_TIMEOUT_MS);
      if (!json.timedOut && json.exitCode === 0) {
        models = parseModelListJson(json.stdout);
      }
    } catch {
      // JSON flag unsupported / transport hiccup — fall through to plain text.
    }

    if (!models) {
      const plain = await hostExec(check.path, ["model", "list"], MODEL_LIST_TIMEOUT_MS);
      if (plain.timedOut) {
        return { success: false, error: "Auggie CLI timed out listing models. Please try again." };
      }
      // Some platforms: auggie may crash during exit but still produce valid stdout.
      models = parseModelListOutput(plain.stdout || plain.stderr || "");
    }

    const sorted = filterAndSortAuggieModels(models);
    if (sorted.length > 0) {
      return { success: true, data: sorted };
    }
    return { success: false, error: "Auggie CLI failed to return a model list. Please try again." };
  } catch (error) {
    return { success: false, error: errorMessage(error) || "Failed to get models" };
  }
});

// ---------------------------------------------------------------------------
// opencode:get-models — `opencode models` via the daemon host
// ---------------------------------------------------------------------------

/** Mirrors main's formatModelLabel (capitalized provider + title-cased id). */
function formatOpencodeModelLabel(provider: string, modelId: string): string {
  const providerLabel = provider.charAt(0).toUpperCase() + provider.slice(1);
  const modelLabel = modelId.replace(/-/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());
  return `${providerLabel} ${modelLabel}`;
}

registerMockIpcHandler(OPENCODE_CHANNELS.GET_MODELS, async (): Promise<GetModelsEnvelope> => {
  try {
    const found = await findBinary("opencode");
    if (!found.available || !found.path) {
      return { success: false, error: "Failed to query opencode CLI for models", data: [] };
    }
    const result = await hostExec(found.path, ["models"], OPENCODE_MODELS_TIMEOUT_MS);
    if (result.timedOut || result.exitCode !== 0) {
      return {
        success: false,
        error: result.stderr || "Failed to query opencode CLI for models",
        data: [],
      };
    }
    const models: ProviderModelEntry[] = [];
    for (const line of result.stdout.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.includes("/") || trimmed.startsWith("#")) continue;
      const [provider, ...modelParts] = trimmed.split("/");
      models.push({ value: trimmed, label: formatOpencodeModelLabel(provider, modelParts.join("/")) });
    }
    if (models.length > 0) return { success: true, data: models };
    return { success: true, data: [], warning: "No models found" };
  } catch (error) {
    return { success: false, error: errorMessage(error), data: [] };
  }
});

// ---------------------------------------------------------------------------
// codex:get-models — static catalog (dynamic probe is main-only)
// ---------------------------------------------------------------------------

registerMockIpcHandler(CODEX_CHANNELS.GET_MODELS, async (): Promise<GetModelsEnvelope> => {
  const staticModels = getCodexModelList();
  const codexCli = await findBinary("codex");
  return {
    success: true,
    data: staticModels,
    warning: codexCli.available
      ? "Codex dynamic model list unavailable; using static model list"
      : "Codex not installed; using static model list",
  };
});

// ---------------------------------------------------------------------------
// claude-code / pi — default-model catalogs when the CLI is installed
// (the ACP model probe has no renderer/daemon arm)
// ---------------------------------------------------------------------------

registerMockIpcHandler(CLAUDE_CODE_CHANNELS.GET_MODELS, async (): Promise<GetModelsEnvelope> => {
  const found = await findBinary("claude");
  if (!found.available) {
    return { success: true, data: [], warning: "Claude Code not available" };
  }
  return {
    success: true,
    data: [
      { value: "default", label: "Default (Claude Code)", description: "Use Claude Code default model" },
    ],
    warning: "Claude Code model list unavailable; using default model",
  };
});

registerMockIpcHandler(PI_CHANNELS.GET_MODELS, async (): Promise<GetModelsEnvelope> => {
  const found = await findBinary("pi");
  return {
    success: true,
    data: [{ value: "default", label: "Default (Pi)", description: "Use Pi default model" }],
    warning: found.available
      ? "Pi model list unavailable; using default model"
      : "Pi command unavailable; using default model",
  };
});

// ---------------------------------------------------------------------------
// cortex / droid — honest terminal states (no catalog surface in this build)
// ---------------------------------------------------------------------------

registerMockIpcHandler(CORTEX_CHANNELS.GET_MODELS, async (): Promise<GetModelsEnvelope> => {
  // Feature-code gated; the renderer cannot verify the gate → default-deny,
  // matching the provider status bridge and main's unresolved branch.
  return { success: true, data: [], warning: "Cortex not available" };
});

registerMockIpcHandler(DROID_CHANNELS.GET_MODELS, async (): Promise<GetModelsEnvelope> => {
  const found = await findBinary("droid");
  if (!found.available) {
    return { success: true, data: [], warning: "Droid not available" };
  }
  // Droid models only exist via the ACP stdio probe (no static catalog);
  // surface that honestly instead of fabricating a list.
  return { success: true, data: [], warning: "Droid model list unavailable in this build" };
});
