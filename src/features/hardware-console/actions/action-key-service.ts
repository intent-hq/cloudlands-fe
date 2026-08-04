/**
 * Action-key handling for the hardware console (ACT06–ACT12).
 *
 * Subscribes an input decoder to the shared manager's raw channel-2 stream
 * (`onRawMessage` — includes the CM2's bare joystick objects that never reach
 * `onNotification`) and, on action-key presses, executes the action mapped to
 * that key against the current app context. Unavailable actions no-op with a
 * subtle toast hint. A fresh decoder is created per connection so the presses
 * resolve against the connected device's per-model mapping. The Codex Micro's
 * factory 2U Mic keycap presses ACT10 + ACT11 together; ACT11 defaults to
 * unset so the pair fires one action, but it stays assignable (Settings warns
 * that an assignment only works with the keys physically unlinked).
 *
 * The per-model mappings hydrate from the shared `hardwareConsole.state`
 * daemon settings bag on the first dispatched action (the legacy flat
 * `actionMapping` array is read as the CM2 entry when the per-model record
 * has none) and write back after each mapping mutation (read-modify-write
 * on the whole bag with only the `actionMappingByModel` field replaced —
 * sibling fields like `keyPins` and the legacy `actionMapping` survive),
 * mirroring the key-pin persistence service.
 *
 * Dependency-light middleware module per src/store/renderer/AGENTS.md: no
 * selector imports — state is read directly off `appStore.state`; the toast
 * lib is imported lazily.
 */
import type { StoreMiddleware } from '$lib/store-shim/types';
import { appClient } from '$lib/client';
import { store as appStore } from '$store/renderer/store';
import { createLogger } from '$lib/utils/client-logger';
import { navigateToRoute } from '$lib/utils/navigation.client';
import { dispatchWindowEvent } from '$lib/utils/window-events';
import { m } from '$shared/paraglide/messages.js';
import {
  actionHudHidden,
  actionHudShown,
  hydrateHardwareConsoleActionMapping,
  hydrateHardwareConsoleCycleScopes,
  setActionKeyMapping,
  setCycleScope,
} from '$store/renderer/slices/hardware-console/hardware-console-slice';
import { openAgentTabRequested } from '$store/renderer/slices/app-layout/app-layout-slice';
import type { HardwareConsoleManager } from '../device/device-manager';
import { getHardwareConsoleManager } from '../instance';
import { HardwareInputDecoder } from '../input/input-decoder';
import type { HardwareDeviceModel, LogicalKeyId } from '../input/types';
import { HARDWARE_CONSOLE_SETTINGS_PATH } from '../assignment/key-pin-persistence-service';
import {
  actionKeyToSlot,
  migrateLegacyCm2DefaultActionMapping,
  normalizeActionMappingsByModel,
  type ActionKeyActionId,
} from './action-mapping';
import { normalizeCycleScopeByFamily } from './cycle-scope';
import { getActionKeyDefinition, type ActionKeyContext } from './action-key-registry';
import { ENCODER_HUD_HIDE_MS } from '../encoder/encoder-service';

const logger = createLogger('HardwareConsoleActionKeys');

/** Shared id: rapid presses update one hint toast instead of stacking. */
const UNAVAILABLE_HINT_TOAST_ID = 'hardware-console-action-unavailable';
const UNAVAILABLE_HINT_DURATION_MS = 2000;

/** The action HUD hides after the same inactivity timeout as the encoder HUD. */
export const ACTION_HUD_HIDE_MS = ENCODER_HUD_HIDE_MS;

/**
 * Composer-focus retry delays: the target chat tab may still be opening
 * (panel switch, cross-workspace navigation), so the `panel:focus-content`
 * event fires a few times — extra dispatches are harmless no-ops once
 * focused (mirrors PanelLayout's 100ms post-switch delay).
 */
export const COMPOSER_FOCUS_DELAYS_MS = [150, 600] as const;

/** How long a pending new-agent composer focus stays armed (daemon round-trip). */
const COMPOSER_FOCUS_ARM_TTL_MS = 15_000;

/** Lazily pull the toast lib so this middleware-reachable module stays light. */
let toastPromise: Promise<(typeof import('svelte-sonner'))['toast']> | null = null;
function getToast() {
  if (!toastPromise) toastPromise = import('svelte-sonner').then((module) => module.toast);
  return toastPromise;
}

export interface ActionKeyDeps {
  /** Navigate the app to a route. Defaults to `navigateToRoute`. */
  navigate?: (route: string) => Promise<void>;
  /** Show the subtle unavailable-action hint. Defaults to a small toast. */
  showUnavailableHint?: (message: string) => void;
  /** Focus an agent tab's chat composer. Defaults to `focusAgentComposer`. */
  focusComposer?: (agentId: string) => void;
}

/**
 * Focus the chat composer of an agent's conversation tab by re-dispatching
 * the existing `panel:focus-content` seam ChatPanel already listens on
 * (panel keyboard navigation). Retried per COMPOSER_FOCUS_DELAYS_MS so a
 * still-mounting tab catches a later dispatch.
 */
export function focusAgentComposer(agentId: string): void {
  for (const delay of COMPOSER_FOCUS_DELAYS_MS) {
    setTimeout(() => {
      dispatchWindowEvent('panel:focus-content', { tabType: 'agent', agentId });
    }, delay);
  }
}

/**
 * Pending composer focus for actions that create an agent asynchronously
 * (new-agent): the agent id only exists once creation completes and its tab
 * opens, so the press arms a one-shot and the middleware fires the focus on
 * the next `openAgentTabRequested` dispatch.
 */
let composerFocusArmedUntil = 0;

/** Arm the one-shot new-agent composer focus. Exported for tests. */
export function armComposerFocusOnNextAgentTab(now = Date.now()): void {
  composerFocusArmedUntil = now + COMPOSER_FOCUS_ARM_TTL_MS;
}

function consumeArmedComposerFocus(now = Date.now()): boolean {
  if (composerFocusArmedUntil === 0 || now > composerFocusArmedUntil) {
    composerFocusArmedUntil = 0;
    return false;
  }
  composerFocusArmedUntil = 0;
  return true;
}

async function showUnavailableToast(message: string): Promise<void> {
  const toast = await getToast();
  toast.info(message, {
    id: UNAVAILABLE_HINT_TOAST_ID,
    duration: UNAVAILABLE_HINT_DURATION_MS,
  });
}

function buildContext(deps: ActionKeyDeps): ActionKeyContext {
  return {
    state: appStore.state,
    dispatch: (action) => appStore.dispatch(action as { type: string }),
    navigate: deps.navigate ?? navigateToRoute,
    focusComposer: deps.focusComposer ?? focusAgentComposer,
    showHint: deps.showUnavailableHint ?? ((hint: string) => void showUnavailableToast(hint)),
  };
}

/**
 * Handle one action-key press against the given model's mapping. Exported
 * for tests. Returns the executed action id, or null when the key was
 * unmapped/unavailable.
 */
export function handleActionKeyPress(
  key: LogicalKeyId,
  deps: ActionKeyDeps = {},
  model: HardwareDeviceModel = 'creator-micro-2',
): ActionKeyActionId | null {
  const slot = actionKeyToSlot(key);
  if (slot === null) return null;
  const actionId = appStore.state.hardwareConsole.actionMappingByModel[model]?.[slot] ?? 'none';
  if (actionId === 'none') return null;

  const definition = getActionKeyDefinition(actionId);
  const context = buildContext(deps);
  if (!definition.isAvailable(context)) {
    const message =
      definition.getUnavailableHint?.(context) ??
      m.hardwareConsole_actionKey_unavailable_message({ label: definition.label });
    context.showHint(message);
    return null;
  }
  try {
    definition.execute(context);
  } catch (error) {
    logger.warn('Action key execution failed', { key, actionId, error });
    return null;
  }
  if (actionId === 'new-agent') {
    // The new agent's id only exists after async creation; arm a one-shot so
    // the middleware focuses its composer when its tab opens.
    armComposerFocusOnNextAgentTab();
  }
  return actionId;
}

/**
 * Wire action-key handling to a manager. Returns the teardown function.
 * Exported for tests; production installs via the middleware below.
 */
export function installHardwareConsoleActionKeys(
  manager: HardwareConsoleManager,
  deps: ActionKeyDeps = {},
): () => void {
  let detachDecoder: (() => void) | null = null;

  const teardownDecoder = (): void => {
    detachDecoder?.();
    detachDecoder = null;
  };

  const setupDecoder = (): void => {
    teardownDecoder();
    const model = manager.connectedDevice?.model ?? 'creator-micro-2';
    const decoder = new HardwareInputDecoder({ deviceModel: model });
    const offKeydown = decoder.on('keydown', ({ key }) => {
      handleActionKeyPress(key, deps, model);
    });
    const offRaw = manager.onRawMessage((message) => decoder.handleMessage(message));
    detachDecoder = () => {
      offRaw();
      offKeydown();
    };
  };

  const offStatus = manager.onStatusChange((status) => {
    if (status === 'connected') setupDecoder();
    else if (status === 'disconnected' || status === 'unavailable') teardownDecoder();
  });
  if (manager.status === 'connected') setupDecoder();

  return () => {
    offStatus();
    teardownDecoder();
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function readBag(): Promise<Record<string, unknown> | null> {
  const setting = await appClient.settings.get(HARDWARE_CONSOLE_SETTINGS_PATH);
  if (setting === null) return null;
  return isRecord(setting.value) ? setting.value : {};
}

/** Read-modify-write: replace only `actionMappingByModel`, preserving sibling fields. */
async function persistActionMapping(
  actionMappingByModel: Record<HardwareDeviceModel, ActionKeyActionId[]>,
): Promise<void> {
  const bag = (await readBag()) ?? {};
  await appClient.settings.update([
    { path: HARDWARE_CONSOLE_SETTINGS_PATH, value: { ...bag, actionMappingByModel } },
  ]);
}

/** Read-modify-write: replace only `cycleScopeByFamily`, preserving sibling fields. */
async function persistCycleScopes(
  cycleScopeByFamily: Record<string, string>,
): Promise<void> {
  const bag = (await readBag()) ?? {};
  await appClient.settings.update([
    { path: HARDWARE_CONSOLE_SETTINGS_PATH, value: { ...bag, cycleScopeByFamily } },
  ]);
}

async function hydrateOnce(): Promise<boolean> {
  try {
    const bag = await readBag();
    if (bag === null) {
      throw new Error(
        `settings.get(${HARDWARE_CONSOLE_SETTINGS_PATH}) returned null — daemon read failed`,
      );
    }
    const legacy = Array.isArray(bag.actionMapping) ? bag.actionMapping : undefined;
    const mappings = normalizeActionMappingsByModel(bag.actionMappingByModel, legacy);
    // One-shot default migration: a persisted CM2 mapping still exactly equal
    // to a prior default generation (never customized) picks up the current
    // defaults and is written back.
    const migrated = migrateLegacyCm2DefaultActionMapping(mappings);
    appStore.dispatch(hydrateHardwareConsoleActionMapping(mappings));
    appStore.dispatch(
      hydrateHardwareConsoleCycleScopes(normalizeCycleScopeByFamily(bag.cycleScopeByFamily)),
    );
    if (migrated) await persistActionMapping(mappings);
    return true;
  } catch (error) {
    logger.error('Action-mapping hydration failed; dispatching defaults', { error });
    appStore.dispatch(
      hydrateHardwareConsoleActionMapping(normalizeActionMappingsByModel(undefined)),
    );
    appStore.dispatch(hydrateHardwareConsoleCycleScopes(normalizeCycleScopeByFamily(undefined)));
    return false;
  }
}

let installed = false;

/**
 * Lazily install on the first dispatched action (same pattern as the
 * key-switch middleware): wires action-key handling, hydrates the mapping
 * from the daemon bag, and persists mapping changes (deferred until
 * hydration settles, mirroring the key-pin persistence service). The shared
 * manager is started by the integration-toggle middleware once the
 * persisted enabled flag hydrates on. Also drives the action-HUD inactivity
 * timer from the `actionHudShown` action itself (mirrors the encoder-HUD
 * timer): rapid presses re-arm it.
 */
export function createHardwareConsoleActionKeyMiddleware(): StoreMiddleware {
  let hydrationStarted = false;
  let hydrationSettled = false;
  let persistQueued = false;
  let persistScopesQueued = false;
  let hudTimer: ReturnType<typeof setTimeout> | null = null;

  const clearHudTimer = (): void => {
    if (hudTimer !== null) clearTimeout(hudTimer);
    hudTimer = null;
  };

  const armHudTimer = (): void => {
    clearHudTimer();
    hudTimer = setTimeout(() => {
      hudTimer = null;
      appStore.dispatch(actionHudHidden());
    }, ACTION_HUD_HIDE_MS);
  };

  const persist = (): void => {
    void persistActionMapping(appStore.state.hardwareConsole.actionMappingByModel).catch(
      (error) =>
        logger.error(`Failed to persist ${HARDWARE_CONSOLE_SETTINGS_PATH} actionMappingByModel`, {
          error,
        }),
    );
  };

  const persistScopes = (): void => {
    void persistCycleScopes(appStore.state.hardwareConsole.cycleScopeByFamily).catch((error) =>
      logger.error(`Failed to persist ${HARDWARE_CONSOLE_SETTINGS_PATH} cycleScopeByFamily`, {
        error,
      }),
    );
  };

  const schedulePersist = (): void => {
    if (!hydrationSettled) {
      persistQueued = true;
      return;
    }
    persist();
  };

  const schedulePersistScopes = (): void => {
    if (!hydrationSettled) {
      persistScopesQueued = true;
      return;
    }
    persistScopes();
  };

  return () => (next) => (action) => {
    if (!installed) {
      installed = true;
      installHardwareConsoleActionKeys(getHardwareConsoleManager());
    }
    if (!hydrationStarted) {
      hydrationStarted = true;
      void hydrateOnce()
        .catch(() => false)
        .then((hydrated) => {
          hydrationSettled = true;
          const shouldFlush = persistQueued && hydrated;
          const shouldFlushScopes = persistScopesQueued && hydrated;
          persistQueued = false;
          persistScopesQueued = false;
          if (shouldFlush) persist();
          if (shouldFlushScopes) persistScopes();
        });
    }

    const result = next(action);

    if (action && action.type === setActionKeyMapping.type) {
      schedulePersist();
    }

    if (action && action.type === setCycleScope.type) {
      schedulePersistScopes();
    }

    if (action && action.type === actionHudShown.type) {
      armHudTimer();
    } else if (action && action.type === actionHudHidden.type) {
      clearHudTimer();
    }

    if (action && action.type === openAgentTabRequested.type && consumeArmedComposerFocus()) {
      // New-agent press armed a one-shot: this tab open is the created
      // agent's — focus its composer.
      const detail = (action as ReturnType<typeof openAgentTabRequested>).payload[1];
      if (detail && typeof detail.agentId === 'string') {
        focusAgentComposer(detail.agentId);
      }
    }

    return result;
  };
}
