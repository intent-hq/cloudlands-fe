/**
 * Model catalog bridge — routes the 7 per-provider `*:get-models` channels
 * (auggie / claude-code / codex / cortex / droid / opencode / pi) to the
 * daemon's per-provider model catalog (`models.list { providerId,
 * forceRefresh }`, PROTOCOL §6.7) for daemon/web builds where no Electron
 * main process serves these channels.
 *
 * The daemon owns probing, parsing, version-keyed persisted caching, and
 * stale/fallback labeling for every provider, so this bridge is a uniform
 * thin call — the exact daemon-build counterpart of the Electron main-process
 * handlers (which call the same RPC via `daemon-model-catalog.ts`).
 *
 * Envelope semantics: `success: true` with `data` rows plus optional
 * `warning` / `stale` fields straight from the daemon; only a wire/transport
 * failure produces `success: false`. Probe/CLI failures never error — the
 * daemon degrades them to last-good + `stale: true` or a static/default
 * fallback with a `warning`.
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
import {
  wireModelsToProviderModels,
  withProviderAliasRows,
  type ProviderModelInfo,
  type WireModelsListResult,
} from "$shared/models/wire-model-info";
import { backendRequest } from "$lib/client/live/backend-transport";

type GetModelsEnvelope = {
  success: boolean;
  data?: ProviderModelInfo[];
  warning?: string;
  stale?: boolean;
  error?: string;
};

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const PROVIDER_MODEL_CHANNELS: Array<[string, string]> = [
  ["auggie", AUGGIE_CHANNELS.GET_MODELS],
  ["claude-code", CLAUDE_CODE_CHANNELS.GET_MODELS],
  ["codex", CODEX_CHANNELS.GET_MODELS],
  ["cortex", CORTEX_CHANNELS.GET_MODELS],
  ["droid", DROID_CHANNELS.GET_MODELS],
  ["opencode", OPENCODE_CHANNELS.GET_MODELS],
  ["pi", PI_CHANNELS.GET_MODELS],
];

for (const [providerId, channel] of PROVIDER_MODEL_CHANNELS) {
  registerMockIpcHandler(channel, async (data?: unknown): Promise<GetModelsEnvelope> => {
    try {
      const forceRefresh =
        (data as { forceRefresh?: boolean } | undefined)?.forceRefresh === true;
      const result = await backendRequest<WireModelsListResult>("models.list", {
        providerId,
        ...(forceRefresh ? { forceRefresh: true } : {}),
      });
      const envelope: GetModelsEnvelope = {
        success: true,
        data: withProviderAliasRows(providerId, wireModelsToProviderModels(result)),
      };
      if (typeof result?.warning === "string" && result.warning) {
        envelope.warning = result.warning;
      }
      if (result?.stale === true) envelope.stale = true;
      return envelope;
    } catch (error) {
      return { success: false, error: errorMessage(error) };
    }
  });
}
