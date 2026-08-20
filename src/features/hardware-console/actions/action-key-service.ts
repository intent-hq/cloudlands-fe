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
 * daemon settings bag when the app-owned saga starts (the legacy flat
 * `actionMapping` array is read as the CM2 entry when the per-model record
 * has none) and write back after each mapping mutation (read-modify-write
 * on the whole bag with only the `actionMappingByModel` field replaced —
 * sibling fields like `keyPins` and the legacy `actionMapping` survive),
 * mirroring the key-pin persistence service.
 *
 * The app-owned saga orchestrates hydration, persistence, timers, and
 * cancellation; this module retains the reusable input and settings helpers.
 */
import { appClient } from '$lib/client';
import { store as appStore } from '$store/renderer/store';
import { createLogger } from '$lib/utils/client-logger';
import { navigateToRoute } from '$lib/utils/navigation.client';
import { dispatchWindowEvent } from '$lib/utils/window-events';
import { m } from '$shared/paraglide/messages.js';
import type { HardwareConsoleManager } from '../device/device-manager';
import { HardwareInputDecoder } from '../input/input-decoder';
import type { HardwareDeviceModel, LogicalKeyId } from '../input/types';
import { HARDWARE_CONSOLE_SETTINGS_PATH } from '../assignment/key-pin-persistence-service';
import {
  actionKeyToSlot,
  migrateLegacyCm2DefaultActionMapping,
  migrateLegacyCodexDefaultActionMapping,
  normalizeActionMappingsByModel,
  type ActionKeyActionId,
} from './action-mapping';
import { normalizeCycleScopeByFamily } from './cycle-scope';
import { cancelPttRecording } from '../voice/ptt-controller';
import { isConsoleOwner } from '../owner-gate';
import { getActionKeyDefinition, type ActionKeyContext } from './action-key-registry';
import { ENCODER_HUD_HIDE_MS } from '../encoder/encoder-service';
import { selectCurrentWorkspaceTabId } from '$store/renderer/slices/tab-state/tab-state-selectors';

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

/** Lazily pull the toast lib so this service stays light. */
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
  /** Console-owner gate (#1928). Defaults to the store-backed `isConsoleOwner`. */
  isOwner?: () => boolean;
  /** Current workspace-tab seam. */
  getCurrentWorkspaceId?: () => string | null;
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
 * opens, so the press arms a one-shot and the saga fires the focus on
 * the next `openAgentTabRequested` dispatch.
 */
let composerFocusArmedUntil = 0;

/** Arm the one-shot new-agent composer focus. Exported for tests. */
function armComposerFocusOnNextAgentTab(now = Date.now()): void {
  composerFocusArmedUntil = now + COMPOSER_FOCUS_ARM_TTL_MS;
}

export function consumeArmedComposerFocus(now = Date.now()): boolean {
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
    workspaceId: (
      deps.getCurrentWorkspaceId ?? (() => selectCurrentWorkspaceTabId.select(appStore.state))
    )(),
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
    // the saga focuses its composer when its tab opens.
    armComposerFocusOnNextAgentTab();
  }
  return actionId;
}

/**
 * Handle one action-key release against the given model's mapping. Only
 * hold-capable actions (registry entries with `executeUp`) react; releases
 * of press-only actions stay ignored. No availability re-check on release —
 * an in-progress hold must always end cleanly. Exported for tests. Returns
 * the executed action id, or null when the release was a no-op.
 */
export function handleActionKeyRelease(
  key: LogicalKeyId,
  deps: ActionKeyDeps = {},
  model: HardwareDeviceModel = 'creator-micro-2',
): ActionKeyActionId | null {
  const slot = actionKeyToSlot(key);
  if (slot === null) return null;
  const actionId = appStore.state.hardwareConsole.actionMappingByModel[model]?.[slot] ?? 'none';
  if (actionId === 'none') return null;

  const definition = getActionKeyDefinition(actionId);
  if (!definition.executeUp) return null;
  try {
    definition.executeUp(buildContext(deps));
  } catch (error) {
    logger.warn('Action key release execution failed', { key, actionId, error });
    return null;
  }
  return actionId;
}

/**
 * Wire action-key handling to a manager. Returns the teardown function.
 * Exported for tests; production installs via the app-owned saga.
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

  const isOwner = deps.isOwner ?? isConsoleOwner;

  const setupDecoder = (): void => {
    teardownDecoder();
    const model = manager.connectedDevice?.model ?? 'creator-micro-2';
    const decoder = new HardwareInputDecoder({ deviceModel: model });
    const offKeydown = decoder.on('keydown', ({ key }) => {
      if (!isOwner()) return;
      handleActionKeyPress(key, deps, model);
    });
    const offKeyup = decoder.on('keyup', ({ key }) => {
      // Releases are never owner-gated: a hold started while this window
      // owned the console (e.g. an in-flight PTT recording) must end cleanly
      // even when ownership flipped mid-hold — the recording completes and
      // transcribes in the window that started it. A window that saw no
      // keydown no-ops here (the PTT pressed-key count is 0, and press-only
      // actions have no `executeUp`).
      handleActionKeyRelease(key, deps, model);
    });
    const offRaw = manager.onRawMessage((message) => decoder.handleMessage(message));
    detachDecoder = () => {
      offRaw();
      offKeydown();
      offKeyup();
    };
  };

  const offStatus = manager.onStatusChange((status) => {
    if (status === 'connected') setupDecoder();
    else if (status === 'disconnected' || status === 'unavailable') {
      teardownDecoder();
      // A hold in progress can never see its keyup once the device is gone.
      cancelPttRecording(buildContext(deps));
    }
  });
  if (manager.status === 'connected') setupDecoder();

  return () => {
    offStatus();
    teardownDecoder();
    cancelPttRecording(buildContext(deps));
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

/** Read the bag for a read-modify-write, failing when the read failed so a persist can never wipe sibling fields. */
async function readBagForPersist(): Promise<Record<string, unknown>> {
  const bag = await readBag();
  if (bag === null) {
    throw new Error(
      `settings.get(${HARDWARE_CONSOLE_SETTINGS_PATH}) returned null — daemon read failed; skipping persist to avoid wiping the bag`,
    );
  }
  return bag;
}

/** Read-modify-write: replace only `actionMappingByModel`, preserving sibling fields. */
export async function persistHardwareConsoleActionMapping(
  actionMappingByModel: Record<HardwareDeviceModel, ActionKeyActionId[]>,
): Promise<void> {
  const bag = await readBagForPersist();
  await appClient.settings.update([
    { path: HARDWARE_CONSOLE_SETTINGS_PATH, value: { ...bag, actionMappingByModel } },
  ]);
}

/** Read-modify-write: replace only `cycleScopeByFamily`, preserving sibling fields. */
export async function persistHardwareConsoleCycleScopes(
  cycleScopeByFamily: Record<string, string>,
): Promise<void> {
  const bag = await readBagForPersist();
  await appClient.settings.update([
    { path: HARDWARE_CONSOLE_SETTINGS_PATH, value: { ...bag, cycleScopeByFamily } },
  ]);
}

export async function loadHardwareConsoleActionKeySettings(): Promise<{
  actionMappingByModel: Record<HardwareDeviceModel, ActionKeyActionId[]>;
  cycleScopeByFamily: ReturnType<typeof normalizeCycleScopeByFamily>;
  migratedDefaults: boolean;
}> {
  const bag = await readBag();
  if (bag === null) {
    throw new Error(
      `settings.get(${HARDWARE_CONSOLE_SETTINGS_PATH}) returned null — daemon read failed`,
    );
  }
  const legacy = Array.isArray(bag.actionMapping) ? bag.actionMapping : undefined;
  const actionMappingByModel = normalizeActionMappingsByModel(bag.actionMappingByModel, legacy);
  const migratedCm2 = migrateLegacyCm2DefaultActionMapping(actionMappingByModel);
  const migratedCodex = migrateLegacyCodexDefaultActionMapping(actionMappingByModel);
  return {
    actionMappingByModel,
    cycleScopeByFamily: normalizeCycleScopeByFamily(bag.cycleScopeByFamily),
    migratedDefaults: migratedCm2 || migratedCodex,
  };
}
