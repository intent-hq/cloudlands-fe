import { isTextEntryTarget } from '$lib/utils/text-entry';
import { DOCK_RECORDING_TOOL_KEYS } from '../components/dock-recording-toolbar';

/** Match the live annotation bar's existing letters; editor-only tools add T/B/C. */
export const CAPTURE_EDITOR_TOOL_KEYS = {
  pointer: DOCK_RECORDING_TOOL_KEYS.pointer,
  box: DOCK_RECORDING_TOOL_KEYS.box,
  draw: DOCK_RECORDING_TOOL_KEYS.pen,
  arrow: DOCK_RECORDING_TOOL_KEYS.arrow,
  text: 'T',
  blur: 'B',
  crop: 'C',
} as const;
export type CaptureEditorKeyTool = keyof typeof CAPTURE_EDITOR_TOOL_KEYS;

/** Local editor keys never take ownership from a field, layer or unfinished operation. */
export function captureEditorToolShortcut(
  event: KeyboardEvent,
  blocked: boolean,
): CaptureEditorKeyTool | null {
  if (
    blocked ||
    event.defaultPrevented ||
    event.isComposing ||
    event.keyCode === 229 ||
    event.repeat ||
    event.metaKey ||
    event.ctrlKey ||
    event.altKey ||
    event.shiftKey ||
    isTextEntryTarget(event.target) ||
    isTextEntryTarget(document.activeElement)
  )
    return null;
  const layers =
    '[role="menu"], [role="dialog"], [role="alertdialog"], [data-slot="select-content"], [data-slot="popover-content"], [data-bits-floating-content-wrapper] [role="listbox"]';
  if (event.target instanceof Element && event.target.closest(`${layers}, [role="listbox"]`))
    return null;
  if (
    [...document.querySelectorAll(layers)].some(
      (layer) => layer.getAttribute('aria-hidden') !== 'true' && layer.getClientRects().length > 0,
    )
  )
    return null;
  return (
    (Object.keys(CAPTURE_EDITOR_TOOL_KEYS) as CaptureEditorKeyTool[]).find(
      (tool) => CAPTURE_EDITOR_TOOL_KEYS[tool].toLowerCase() === event.key.toLowerCase(),
    ) ?? null
  );
}
