import { app } from 'electron';

type ClipboardInput = Pick<
  Electron.Input,
  'type' | 'key' | 'meta' | 'control' | 'alt' | 'shift' | 'isAutoRepeat'
>;

const ACTIONS = { c: 'copy', x: 'cut', v: 'paste' } as const;

/**
 * @internal
 * The edit command for Super+C/X/V on Linux, so Mac-keyboard users (Intent OS,
 * Asahi) can copy, cut and paste with Cmd as well as Ctrl. In the terminal
 * Ctrl+C stays an interrupt; Cmd+C copies the selection.
 */
export function metaClipboardAction(input: ClipboardInput): 'copy' | 'cut' | 'paste' | undefined {
  if (input.type !== 'keyDown' || !input.meta || input.control || input.alt || input.shift) {
    return undefined;
  }
  return ACTIONS[input.key.toLowerCase() as keyof typeof ACTIONS];
}

/** Linux only: macOS already maps Cmd through the Edit menu. */
export function setupMetaClipboardShortcuts(platform: NodeJS.Platform = process.platform): void {
  if (platform !== 'linux') return;
  app.on('web-contents-created', (_event, contents) => {
    contents.on('before-input-event', (event, input) => {
      const action = metaClipboardAction(input);
      if (!action) return;
      event.preventDefault();
      if (!input.isAutoRepeat || action === 'paste') contents[action]();
    });
  });
}
