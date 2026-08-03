/**
 * Joystick radial prompt picker service for the hardware console.
 *
 * Three responsibilities, one middleware:
 * 1. Usage tracking — observes composer submissions (`sendMessage`) and
 *    records them in the prompt-usage tracker, persisting the tracker into
 *    the shared `hardwareConsole.state` daemon bag (read-modify-write so
 *    sibling fields like `keyPins` survive). The top-N limit
 *    (`promptPickerLimit`, device-panel setting) is hydrated from the same
 *    bag but only ever read here.
 * 2. Joystick session — subscribes an input decoder to the shared manager's
 *    raw channel-2 stream (`onRawMessage` — includes the CM2's bare `{a,d}`
 *    joystick frames that never reach `onNotification`). Deflection past the
 *    dead-zone opens the radial overlay with the top-N prompts by sector;
 *    sector math runs here from the raw angle (converted from the device
 *    convention — 0 = 3 o'clock, clockwise — to screen turns, see
 *    `radial-layout.ts`) over N+1 slices: one per prompt plus a dedicated
 *    Cancel slice at 6 o'clock.
 * 3. Release handling — release while a prompt sector is highlighted inserts
 *    that prompt at the cursor of the focused text input (never auto-sends);
 *    release on the Cancel sector inserts nothing, and a centered release
 *    cancels too. "Centered" means the stick dwelled inside the selection
 *    radius for {@link DEFAULT_CENTER_DWELL_MS} before release, so the
 *    spring snap-back through the hysteresis band still commits.
 *
 * Dependency-light middleware module: no selector imports — reads
 * `appStore.state` directly (resolveKeySlots precedent).
 */
import type { StoreMiddleware } from '$lib/store-shim/types';
import { appClient } from '$lib/client';
import { store as appStore } from '$store/renderer/store';
import { createLogger } from '$lib/utils/client-logger';
import { sendMessage } from '$store/renderer/slices/chat-state/chat-state-slice';
import {
  hydrateHardwareConsolePrompts,
  promptUsageRecorded,
  radialPromptPickerClosed,
  radialPromptPickerOpened,
  radialPromptPickerSectorChanged,
  setPromptPickerLimit,
} from '$store/renderer/slices/hardware-console/hardware-console-slice';
import type { HardwareConsoleManager } from '../device/device-manager';
import { getHardwareConsoleManager } from '../instance';
import { HardwareInputDecoder, DEFAULT_JOYSTICK_ENGAGE_DISTANCE } from '../input/input-decoder';
import { radialCancelSector, radialSectorForAngle } from './radial-layout';
import { HARDWARE_CONSOLE_SETTINGS_PATH } from '../assignment/key-pin-persistence-service';
import {
  clampPromptPickerLimit,
  DEFAULT_PROMPT_PICKER_LIMIT,
  parsePromptUsage,
  topPromptTexts,
} from './curation';
import { insertPromptText } from './insertion';

const logger = createLogger('HardwareConsolePromptPicker');

/** Dwell inside the selection radius that turns a release into a cancel. */
export const DEFAULT_CENTER_DWELL_MS = 150;

export interface PromptPickerJoystickDeps {
  /** Top-N prompt texts to surface. Defaults to the store's ranked tracker. */
  getTopPrompts?: () => string[];
  /** Dispatch into the app store. Defaults to `appStore.dispatch`. */
  dispatch?: (action: unknown) => void;
  /** Insert text into the focused editable. Defaults to the insertion seam. */
  insertText?: (text: string) => boolean;
  now?: () => number;
  /** Deflection at/above which the current sector is the selection. */
  selectDistance?: number;
  /** See {@link DEFAULT_CENTER_DWELL_MS}. */
  centerDwellMs?: number;
}

interface JoystickSession {
  prompts: string[];
  selection: number | null;
  /** Timestamp the stick last dropped inside the selection radius. */
  belowSince: number | null;
}

function defaultGetTopPrompts(): string[] {
  const { promptUsage, promptPickerLimit } = appStore.state.hardwareConsole;
  return topPromptTexts(promptUsage, clampPromptPickerLimit(promptPickerLimit));
}

/**
 * Wire the joystick radial session to a manager. Returns the teardown.
 * Exported for tests; production installs via the middleware below.
 */
export function installHardwareConsolePromptPickerJoystick(
  manager: HardwareConsoleManager,
  deps: PromptPickerJoystickDeps = {},
): () => void {
  const now = deps.now ?? Date.now;
  const dispatch = deps.dispatch ?? ((action: unknown) => appStore.dispatch(action as never));
  const insertText = deps.insertText ?? ((text: string) => insertPromptText(text));
  const getTopPrompts = deps.getTopPrompts ?? defaultGetTopPrompts;
  const selectDistance = deps.selectDistance ?? DEFAULT_JOYSTICK_ENGAGE_DISTANCE;
  const centerDwellMs = deps.centerDwellMs ?? DEFAULT_CENTER_DWELL_MS;

  let session: JoystickSession | null = null;
  let detachDecoder: (() => void) | null = null;

  const sectorFor = (angle: number, prompts: string[]): number =>
    radialSectorForAngle(angle, prompts.length);

  const closeSession = (): void => {
    if (!session) return;
    session = null;
    dispatch(radialPromptPickerClosed());
  };

  const setSelection = (selection: number | null): void => {
    if (!session || session.selection === selection) return;
    session.selection = selection;
    dispatch(radialPromptPickerSectorChanged(selection));
  };

  const onEngage = (angle: number, distance: number): void => {
    const prompts = getTopPrompts();
    if (prompts.length === 0) return;
    const sector = sectorFor(angle, prompts);
    session = {
      prompts,
      selection: sector,
      belowSince: distance >= selectDistance ? null : now(),
    };
    dispatch(radialPromptPickerOpened(prompts, sector));
  };

  const onMove = (angle: number, distance: number): void => {
    if (!session) return;
    if (distance >= selectDistance) {
      session.belowSince = null;
      setSelection(sectorFor(angle, session.prompts));
      return;
    }
    if (session.belowSince === null) session.belowSince = now();
    else if (now() - session.belowSince >= centerDwellMs) setSelection(null);
  };

  const onRelease = (): void => {
    if (!session) return;
    const { prompts, selection, belowSince } = session;
    const dwelledCentered = belowSince !== null && now() - belowSince >= centerDwellMs;
    closeSession();
    if (selection === null || dwelledCentered) return;
    if (selection === radialCancelSector(prompts.length)) return;
    const prompt = prompts[selection];
    if (prompt !== undefined && !insertText(prompt)) {
      logger.info('Radial prompt release with no focused text input; insertion skipped');
    }
  };

  const teardownDecoder = (): void => {
    detachDecoder?.();
    detachDecoder = null;
    closeSession();
  };

  const setupDecoder = (): void => {
    teardownDecoder();
    const decoder = new HardwareInputDecoder({
      deviceModel: manager.connectedDevice?.model ?? 'creator-micro-2',
    });
    const offEngage = decoder.on('joystickengage', ({ angle, distance }) =>
      onEngage(angle, distance),
    );
    const offMove = decoder.on('joystickmove', ({ angle, distance }) => onMove(angle, distance));
    const offRelease = decoder.on('joystickrelease', () => onRelease());
    const offRaw = manager.onRawMessage((message) => decoder.handleMessage(message));
    detachDecoder = () => {
      offRaw();
      offEngage();
      offMove();
      offRelease();
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

/** Extract the submitted composer text from a `sendMessage` action, or null. */
export function extractSubmittedPromptText(action: unknown): string | null {
  if (typeof action !== 'object' || action === null) return null;
  const { type, payload } = action as { type?: unknown; payload?: unknown };
  if (type !== sendMessage.type) return null;
  if (typeof payload !== 'object' || payload === null) return null;
  const inner = (payload as { payload?: unknown }).payload;
  if (typeof inner !== 'object' || inner === null) return null;
  const text = (inner as { text?: unknown }).text;
  return typeof text === 'string' && text.trim().length > 0 ? text : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function readBag(): Promise<Record<string, unknown> | null> {
  const setting = await appClient.settings.get(HARDWARE_CONSOLE_SETTINGS_PATH);
  if (setting === null) return null;
  return isRecord(setting.value) ? setting.value : {};
}

/** Read-modify-write: replace only `promptUsage`, preserving sibling fields. */
async function persistPromptUsage(): Promise<void> {
  const bag = (await readBag()) ?? {};
  const { promptUsage } = appStore.state.hardwareConsole;
  await appClient.settings.update([
    { path: HARDWARE_CONSOLE_SETTINGS_PATH, value: { ...bag, promptUsage } },
  ]);
}

/** Read-modify-write: replace only `promptPickerLimit`, preserving sibling fields. */
async function persistPromptPickerLimit(): Promise<void> {
  const bag = (await readBag()) ?? {};
  const { promptPickerLimit } = appStore.state.hardwareConsole;
  await appClient.settings.update([
    { path: HARDWARE_CONSOLE_SETTINGS_PATH, value: { ...bag, promptPickerLimit } },
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
    appStore.dispatch(
      hydrateHardwareConsolePrompts(
        parsePromptUsage(bag.promptUsage),
        clampPromptPickerLimit(bag.promptPickerLimit),
      ),
    );
    return true;
  } catch (error) {
    logger.error('Prompt-tracker hydration failed; dispatching defaults', { error });
    appStore.dispatch(hydrateHardwareConsolePrompts([], DEFAULT_PROMPT_PICKER_LIMIT));
    return false;
  }
}

/**
 * Lazily hydrates the prompt tracker from the daemon bag and installs the
 * joystick session on the first dispatched action (LED-status precedent),
 * then records every composer submission and persists the tracker — and the
 * device-panel `promptPickerLimit` setting on change — (read-modify-write;
 * writes before hydration settles are deferred and flushed once, mirroring
 * the key-pin persistence service).
 */
export function createHardwareConsolePromptPickerMiddleware(): StoreMiddleware {
  let installed = false;
  let hydrationSettled = false;
  let usagePersistQueued = false;
  let limitPersistQueued = false;

  const schedulePersistUsage = (): void => {
    if (!hydrationSettled) {
      usagePersistQueued = true;
      return;
    }
    void persistPromptUsage().catch((error) =>
      logger.error(`Failed to persist ${HARDWARE_CONSOLE_SETTINGS_PATH} promptUsage`, { error }),
    );
  };

  const schedulePersistLimit = (): void => {
    if (!hydrationSettled) {
      limitPersistQueued = true;
      return;
    }
    void persistPromptPickerLimit().catch((error) =>
      logger.error(`Failed to persist ${HARDWARE_CONSOLE_SETTINGS_PATH} promptPickerLimit`, {
        error,
      }),
    );
  };

  return () => (next) => (action) => {
    if (!installed) {
      installed = true;
      const manager = getHardwareConsoleManager();
      installHardwareConsolePromptPickerJoystick(manager);
      void manager.start();
      void hydrateOnce()
        .catch(() => false)
        .then((hydrated) => {
          hydrationSettled = true;
          const flushUsage = usagePersistQueued && hydrated;
          const flushLimit = limitPersistQueued && hydrated;
          usagePersistQueued = false;
          limitPersistQueued = false;
          if (flushUsage) schedulePersistUsage();
          if (flushLimit) schedulePersistLimit();
        });
    }

    const result = next(action);

    const text = extractSubmittedPromptText(action);
    if (text !== null) appStore.dispatch(promptUsageRecorded(text));
    if (action && action.type === promptUsageRecorded.type) schedulePersistUsage();
    if (action && action.type === setPromptPickerLimit.type) schedulePersistLimit();

    return result;
  };
}
