# Dynamic Island Agent Progress Integration Plan

## Goals

- Surface live status of active agents directly in the MacBook notch / Dynamic Island area without requiring the main Electron window.
- Reuse AgentNotch concepts (telemetry streaming, compact UI, completion notifications) as reference only; all code remains in-repo.
- Keep the solution opt-in, power efficient, and fully local.

## Reference Insights from AgentNotch

1. **Data Path**: AgentNotch ingests OTLP/HTTP logs + metrics, then maps them onto per-assistant status indicators. We can replicate the idea by sourcing from our existing `eventCollector` and observability IPC streams rather than OTLP.
2. **UI Shell**: AgentNotch renders a super-compact indicator anchored to the notch, expanding into a popover for history/settings. Electron cannot draw inside the notch directly, but we can emulate this using a translucent `Tray` + popover window sized to the safe notch region.
3. **Signals**: Token usage, tool call cadence, and completion notifications are the most useful signals. For our multi-agent manager we will emit `AgentProgressSnapshot`s that include state (`thinking`, `executing tool`, `awaiting input`, `idle`) plus metrics (`steps completed`, `token usage`, `ETA`).

## Proposed Architecture

```
Agent subsystems (workspace, events, backend)
        │
        ▼
UnifiedEventCollector (existing) ──▶ DynamicIslandEventBridge (new main process module)
        │                                 │
        │                                 ├─ Aggregates AgentProgressSnapshot per agent/session
        │                                 └─ Publishes IPC stream `dynamic-island:progress`
        ▼
Observability store / renderer          │
                                         ▼
                              Dynamic Island UI shell (Tray + BrowserWindow)
                              ├─ Collapsed notch indicator (status LEDs + token ticker)
                              └─ Expanded popover (top agents, actions, errors)
```

### Data Layer

- Extend `eventCollector.collect` call-sites (agent lifecycle, tool operations, streaming) with `progressHint` metadata; renderer-side `eventCollector` IPC invoke should be re-enabled so main sees all events.
- Introduce `AgentProgressSnapshot` type in `src/features/agent/main/agent-progress.ts` that normalizes stage, % completion, tokens, latency, tool label, and severity.
- Add `DynamicIslandEventBridge` (main process) that subscribes to `eventCollector` and `unifiedEventBus`. It maintains an in-memory map of active agents and emits debounced snapshots (e.g., every 250ms when something changes).

### Decided Implementation Details (based on audit)

- Single firehose: use `UnifiedEventCollector` as the bridge source; ensure any workspace-only lifecycle events also emit into the collector rather than subscribing separately to the workspace bus.
- Progress shape: add `progressHint` on `AgentEvent.data` and normalize into `AgentProgressSnapshot` with `{ agentId, sessionId, workspaceId, stage: 'starting' | 'thinking' | 'tool' | 'responding' | 'idle' | 'error' | 'completed', percent?, stepText?, toolName?, tokenUsage?, startedAt, updatedAt, severity? }`.
- Event mapping: `AGENT_STARTED` -> `starting`; `THINKING_STARTED/STOPPED` -> `thinking`; `TOOL_CALL_STARTED/COMPLETED/ERROR` -> `tool` (0→100%; severity on error); assistant-side `MESSAGE_*` -> `responding`; `AGENT_COMPLETED/ERROR` -> terminal stage. Token usage stays in `metadata.tokenUsage`.
- IPC plumbing: add `DYNAMIC_ISLAND_CHANNELS` to the central registry and regenerate preload allowlists; mirror the subscribe pattern from `observability:subscribe` for streaming snapshots.
- Shell: no existing tray/panel controller—implement a new `DynamicIslandController` with Tray + `type: 'panel'` BrowserWindow aligned to notch safe area; handle display changes and hover/pin transitions; fall back near the menu bar on non-notch Macs.
- Settings: expose the opt-in toggle in the settings page (`settings/observability`), persist via the config service, and lazy-init the controller when enabled.

### IPC & Config

- New IPC channels under `DYNAMIC_ISLAND_CHANNELS` (define in `src/shared/ipc/channels.ts`):
  - `dynamic-island:subscribe` (renderer ⇄ main, streaming updates)
  - `dynamic-island:get-settings` / `dynamic-island:update-settings`
- Persist lightweight preferences (`enabled`, `showTokenCounts`, `maxAgentsShown`) via existing config service.

### Native Shell

- Implement `DynamicIslandController` in `src/main/dynamic-island/controller.ts`:
  - Creates an Electron `Tray` with a transparent PNG sized to notch height.
  - Hosts a hidden, always-on-top `BrowserWindow` (`type: 'panel'`, `frame: false`, `vibrancy: 'menu'`, `resizable: false`) that aligns directly beneath the notch safe area using `screen.getPrimaryDisplay().bounds` + `safeArea`.
  - Collapsed state shows a 44px-wide pill with gradient background; expanded state animates to ~320px showing progress rows.
  - Handles hover/click interactions similar to AgentNotch (hover expands, click pins and shows details/settings button).
- Use a dedicated Svelte mini-app mounted in `src/routes/dynamic-island/` with CSS tuned for macOS menu bar rendering (no Tailwind, inline styles for sub-pixel alignment).

### Renderer Components

- `DynamicIslandStore` in `src/features/notifications/stores/dynamic-island.store.ts` subscribes to the IPC stream and derives `topAgents`, `activeTool`, and `completionQueue`.
- Minimal Svelte components:
  - `DynamicIslandBadge.svelte`: renders per-agent dot + spinner + percent.
  - `DynamicIslandPopover.svelte`: list view (agent name, step text, timer, CTA to focus workspace tab).
  - `DynamicIslandSettings.svelte`: toggles for telemetry fields, limit to workspace, privacy copy.

### Interaction with Multi-Agent Manager

- When a new agent session starts, the bridge indicates "Agent X preparing" once `AgentEventType.AGENT_STARTED` fires.
- Tool execution updates map to `Executing <toolName>` with progress derived from chunk counts or known stage counts.
- Completion triggers `agent:completed` -> popover shows final status for 5s, collapses automatically unless pinned.
- Errors highlight row in red and optionally trigger native notification (respecting settings).

## Implementation Phases

### Phase 1 – Telemetry & Progress Modeling

1. Audit existing agent lifecycle events in `src/features/agent/main/*` and `src/features/events/*` to ensure start/stop/tool events contain enough metadata for progress (tokens, step counts).
2. Add `AgentProgressSnapshot` & conversion utilities (map from `AgentEvent` to snapshot).
3. Unit tests under `src/features/agent/main/__tests__/agent-progress.test.ts` verifying stage transitions and throttling.

### Phase 2 – Main Process Bridge & IPC

1. Create `DynamicIslandEventBridge` subscribing to `eventCollector` (import in `src/main/index.ts` next to other IPC setups).
2. Implement throttled publisher to `BrowserWindow` via dedicated IPC channels; reuse patterns from `setupObservabilityIPC` for subscribe/unsubscribe.
3. Write integration tests (Vitest) covering subscription lifecycle and data consolidation.

### Phase 3 – Native Shell & Window Management

1. Implement controller managing Tray icon + popover window; handle display changes (multi-monitor) and macOS-specific quirks (Mission Control, dark mode sync).
2. Ensure accessibility + power efficiency (pause rendering when window hidden, use `requestAnimationFrame` only while visible).
3. Provide fallback UI when no notch: float near menu bar center.

### Phase 4 – Svelte UI Implementation

1. Build Svelte components for badge/popover, backed by store + IPC client.
2. Apply theme tokens consistent with existing app (import from `app.css`), but freeze layout to 1x scale for crisp notch rendering.
3. Add hover/pin animations (CSS transitions) and ensure text truncates gracefully.

### Phase 5 – Settings, Opt-in, QA

1. Add toggle in main app settings page (`src/routes/settings/observability/+page.svelte`) enabling Dynamic Island integration.
2. Persist user preference in config service; start controller only when enabled (lazy init to save memory).
3. Create test plan: unit (agent progress), integration (IPC), manual QA checklist (multiple agents, error states, dark/light mode, notch vs non-notch, Mission Control, sleep/wake).
4. Document troubleshooting in `docs/dynamic-island-agent-progress.md` (this file) and link from `docs/AGENT_ARCHITECTURE.md`.

## How This Benefits the App

- **At-a-glance awareness**: Users can see which agents are running and their stages without opening the main window, ideal for multi-agent workflows where tasks run in the background.
- **Reduced context switching**: The notch indicator mirrors AgentNotch’s minimal UI, letting users glance at progress while coding in other apps.
- **Better error & completion feedback**: Immediate notch popups for errors or completion reduce the need for noisy desktop notifications.
- **Telemetry reuse**: By tapping into the existing unified event collector, we avoid duplicating tracking logic and stay aligned with observability tooling.

## Next Steps

1. Finalize design mocks for collapsed/expanded states.
2. Spike on Tray + popover alignment to confirm notch-safe placement.
3. Parallelize Phase 1 (telemetry) and Phase 3 (native shell) since they are loosely coupled, then integrate via IPC in Phase 2.
