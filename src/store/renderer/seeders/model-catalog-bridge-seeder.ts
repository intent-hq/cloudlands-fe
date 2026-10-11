/**
 * Model catalog bridge — routes the per-provider `*:get-models` channels
 * (antigravity / auggie / claude-code / codex / cortex / droid / grok / opencode / pi /
 * unsloth) to the daemon's per-provider model catalog (`models.list { providerId,
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
import { registerMockIpcHandler } from '$shared/ipc-mock-router';
import {
  ANTIGRAVITY_CHANNELS,
  AUGGIE_CHANNELS,
  CLAUDE_CODE_CHANNELS,
  CODEX_CHANNELS,
  CORTEX_CHANNELS,
  DROID_CHANNELS,
  GROK_CHANNELS,
  OPENCODE_CHANNELS,
  PI_CHANNELS,
  UNSLOTH_CHANNELS,
} from '$shared/ipc/channels';

import { backendRequest } from '$lib/client/live/backend-transport';

import { createProviderModelCatalogRead } from '$lib/client/live/provider-model-catalog-read';
const readProviderModelCatalog = createProviderModelCatalogRead(backendRequest);

const PROVIDER_MODEL_CHANNELS: Array<[string, string]> = [
  ['antigravity', ANTIGRAVITY_CHANNELS.GET_MODELS],
  ['auggie', AUGGIE_CHANNELS.GET_MODELS],
  ['claude-code', CLAUDE_CODE_CHANNELS.GET_MODELS],
  ['codex', CODEX_CHANNELS.GET_MODELS],
  ['cortex', CORTEX_CHANNELS.GET_MODELS],
  ['droid', DROID_CHANNELS.GET_MODELS],
  ['grok', GROK_CHANNELS.GET_MODELS],
  ['opencode', OPENCODE_CHANNELS.GET_MODELS],
  ['pi', PI_CHANNELS.GET_MODELS],
  ['unsloth', UNSLOTH_CHANNELS.GET_MODELS],
];

// Source IPC compatibility binding; remove when legacy IPC catalog consumers retire.
for (const [providerId, channel] of PROVIDER_MODEL_CHANNELS) {
  registerMockIpcHandler(channel, (data?: unknown) =>
    readProviderModelCatalog(providerId, {
      forceRefresh: (data as { forceRefresh?: boolean } | undefined)?.forceRefresh === true,
      workspaceId: (data as { workspaceId?: string } | undefined)?.workspaceId,
    }),
  );
}
