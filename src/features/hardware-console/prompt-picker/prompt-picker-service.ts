/**
 * Joystick radial prompt picker service for the hardware console.
 *
 * Three responsibilities, coordinated by the app-owned saga:
 * 1. Usage tracking — observes composer submissions (`sendMessage`) and
 *    records them in the prompt-usage tracker, persisting the tracker into
 *    the shared `hardwareConsole.state` daemon bag (read-modify-write so
 *    sibling fields like `keyPins` survive). The top-N limit
 *    (`promptPickerLimit`, device-panel setting) is hydrated from the same
 *    bag but only ever read here.
 * 2. Joystick session — subscribes an input decoder to the shared manager's
 *    raw channel-2 stream (`onRawMessage` — includes the CM2's bare `{a,d}`
 *    joystick frames that never reach `onNotification`). Deflection past the
 *    dead-zone opens the radial overlay: a fixed 8-direction ring with the
 *    focused chat's suggested prompts at top, top-right and right, Cancel at
 *    the bottom, and the top-N used prompts in the other directions (see
 *    `radial-layout.ts`). Direction math runs here from the raw angle
 *    (device convention — 0 = 3 o'clock, clockwise — converted to screen
 *    turns).
 * 3. Release handling — release on a chat suggestion sends it right away,
 *    like clicking it; release on a used prompt inserts it at the cursor of
 *    the focused text input (never auto-sends). Cancel, an empty direction,
 *    and a centered release do nothing. "Centered" means the stick dwelled inside the selection
 *    radius for {@link DEFAULT_CENTER_DWELL_MS} before release, so the
 *    spring snap-back through the hysteresis band still commits.
 *
 * This module retains the reusable joystick, parsing, and settings helpers;
 * saga orchestration owns hydration, persistence, and cancellation.
 */
import {
  HARDWARE_CONSOLE_SETTINGS_PATH,
  readHardwareConsoleSettingsBag,
  persistHardwareConsoleSettingsPatch,
} from '../settings-bag';
import { store as appStore } from '$store/renderer/store';
import { createLogger } from '$lib/utils/client-logger';
import { sendMessage } from '$store/renderer/slices/chat-state/chat-state-slice';
import {
  radialPromptPickerClosed,
  radialPromptPickerOpened,
  radialPromptPickerSectorChanged,
} from '$store/renderer/slices/hardware-console/hardware-console-slice';
import type { HardwareConsoleManager } from '../device/device-manager';
import { HardwareInputDecoder, DEFAULT_JOYSTICK_ENGAGE_DISTANCE } from '../input/input-decoder';
import {
  buildRadialSlots,
  isActionSlot,
  nextSelectableSlot,
  radialSlotForAngle,
  type RadialSlot,
} from './radial-layout';
import { type ChatSuggestionSource, getFocusedChatSuggestions } from './chat-suggestions';
import {
  clampPromptPickerLimit,
  type PromptUsageEntry,
  parsePromptUsage,
  topPromptTexts,
} from './curation';
import { insertPromptText } from './insertion';
import { isConsoleOwner } from '../owner-gate';

const logger = createLogger('HardwareConsolePromptPicker');

/** Dwell inside the selection radius that turns a release into a cancel. */
export const DEFAULT_CENTER_DWELL_MS = 150;

export interface PromptPickerJoystickDeps {
  /** Top-N prompt texts to surface. Defaults to the store's ranked tracker. */
  getTopPrompts?: () => string[];
  /** The focused chat's suggestions. Defaults to the ChatPanel-published source. */
  getSuggestions?: () => ChatSuggestionSource | null;
  /** Dispatch into the app store. Defaults to `appStore.dispatch`. */
  dispatch?: (action: unknown) => void;
  /** Insert text into the focused editable. Defaults to the insertion seam. */
  insertText?: (text: string) => boolean;
  now?: () => number;
  /** Deflection at/above which the current sector is the selection. */
  selectDistance?: number;
  /** See {@link DEFAULT_CENTER_DWELL_MS}. */
  centerDwellMs?: number;
  /** Console-owner gate (#1928). Defaults to the store-backed `isConsoleOwner`. */
  isOwner?: () => boolean;
  /** Active-session keyboard fallback; null disables it for non-DOM hosts. */
  keyboardTarget?: EventTarget | null;
}

interface JoystickSession {
  slots: RadialSlot[];
  /** Chat that offered the suggestions when the stick engaged. */
  source: ChatSuggestionSource | null;
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
 * Exported for tests; production installs via the app-owned saga.
 */
export function installHardwareConsolePromptPickerJoystick(
  manager: HardwareConsoleManager,
  deps: PromptPickerJoystickDeps = {},
): () => void {
  const now = deps.now ?? Date.now;
  const dispatch = deps.dispatch ?? ((action: unknown) => appStore.dispatch(action as never));
  const insertText = deps.insertText ?? ((text: string) => insertPromptText(text));
  const getTopPrompts = deps.getTopPrompts ?? defaultGetTopPrompts;
  const getSuggestions = deps.getSuggestions ?? getFocusedChatSuggestions;
  const selectDistance = deps.selectDistance ?? DEFAULT_JOYSTICK_ENGAGE_DISTANCE;
  const centerDwellMs = deps.centerDwellMs ?? DEFAULT_CENTER_DWELL_MS;
  const isOwner = deps.isOwner ?? isConsoleOwner;
  const keyboardTarget =
    deps.keyboardTarget === undefined
      ? typeof window === 'undefined'
        ? null
        : window
      : deps.keyboardTarget;

  let session: JoystickSession | null = null;
  let detachDecoder: (() => void) | null = null;

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
    // Only the owner opens a session; move/release handlers below stay
    // session-guarded, so a session already open when ownership is lost
    // still tracks and closes cleanly in the window that opened it —
    // but `onRelease` re-checks ownership before inserting.
    if (!isOwner()) return;
    const source = getSuggestions();
    const suggestions = [...(source?.prompts ?? [])];
    const prompts = getTopPrompts();
    const slots = buildRadialSlots(suggestions, prompts);
    if (!slots.some(isActionSlot)) return;
    const sector = radialSlotForAngle(angle);
    session = {
      slots,
      source,
      selection: sector,
      belowSince: distance >= selectDistance ? null : now(),
    };
    dispatch(radialPromptPickerOpened(suggestions, prompts, sector));
  };

  const onMove = (angle: number, distance: number): void => {
    if (!session) return;
    if (distance >= selectDistance) {
      session.belowSince = null;
      setSelection(radialSlotForAngle(angle));
      return;
    }
    if (session.belowSince === null) session.belowSince = now();
    else if (now() - session.belowSince >= centerDwellMs) setSelection(null);
  };

  const onRelease = (): void => {
    if (!session) return;
    const { slots, source, selection, belowSince } = session;
    const dwelledCentered = belowSince !== null && now() - belowSince >= centerDwellMs;
    closeSession();
    // Ownership moved mid-session (#1928): the session still closes here,
    // but insertion would target this non-owner window's editor — skip it.
    if (!isOwner()) return;
    if (selection === null || dwelledCentered) return;
    const slot = slots[selection];
    if (slot?.kind === 'suggestion') {
      // The offering chat must still be the focused one, or the send would
      // land in a conversation the user is no longer looking at.
      if (source && getSuggestions() === source) source.send(slot.text);
      else logger.info('Radial suggestion release after its chat lost focus; send skipped');
      return;
    }
    if (slot?.kind === 'prompt' && !insertText(slot.text)) {
      logger.info('Radial prompt release with no focused text input; insertion skipped');
    }
  };

  // Keep focus in the original editor so insertion still targets it. Only an
  // active owner session consumes keys; Escape also clears the service session
  // so a later joystick release cannot insert a canceled prompt.
  const onKeydown = (event: Event): void => {
    if (!session) return;
    const key = event as KeyboardEvent;
    if (key.isComposing || key.altKey || key.ctrlKey || key.metaKey || key.defaultPrevented) return;
    if (!['Escape', 'Enter', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(key.key))
      return;
    if (!isOwner()) {
      closeSession();
      return;
    }
    key.preventDefault();
    key.stopImmediatePropagation();
    if (key.key === 'Escape') {
      closeSession();
    } else if (key.key === 'Enter') {
      onRelease();
    } else {
      const direction = key.key === 'ArrowLeft' || key.key === 'ArrowUp' ? -1 : 1;
      session.belowSince = null;
      setSelection(nextSelectableSlot(session.slots, session.selection, direction));
    }
  };
  keyboardTarget?.addEventListener('keydown', onKeydown, true);

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
    keyboardTarget?.removeEventListener('keydown', onKeydown, true);
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

/** Read-modify-write: replace only `promptUsage`, preserving sibling fields. */
export async function persistHardwareConsolePromptUsage(
  promptUsage: PromptUsageEntry[],
): Promise<void> {
  await persistHardwareConsoleSettingsPatch({ promptUsage });
}

/** Read-modify-write: replace only `promptPickerLimit`, preserving sibling fields. */
export async function persistHardwareConsolePromptPickerLimit(
  promptPickerLimit: number,
): Promise<void> {
  await persistHardwareConsoleSettingsPatch({ promptPickerLimit });
}

export async function loadHardwareConsolePrompts(): Promise<{
  promptUsage: ReturnType<typeof parsePromptUsage>;
  promptPickerLimit: number;
}> {
  const bag = await readHardwareConsoleSettingsBag();
  if (bag === null) {
    throw new Error(
      `settings.get(${HARDWARE_CONSOLE_SETTINGS_PATH}) returned null — daemon read failed`,
    );
  }
  return {
    promptUsage: parsePromptUsage(bag.promptUsage),
    promptPickerLimit: clampPromptPickerLimit(bag.promptPickerLimit),
  };
}
