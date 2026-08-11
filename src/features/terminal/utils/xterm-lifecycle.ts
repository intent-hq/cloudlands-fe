import type { Terminal } from '@xterm/xterm';

type DisposableXterm = Pick<Terminal, 'dispose'>;

/**
 * Let xterm 5.x drain the viewport timer queued by open()/fit() before disposal.
 * This mirrors the timer cleanup added upstream for xterm 6 in xtermjs/xterm.js#4984.
 */
export function disposeXtermAfterViewportSync(
  terminal: DisposableXterm,
  onError?: (error: unknown) => void,
): ReturnType<typeof setTimeout> {
  return setTimeout(() => {
    try {
      terminal.dispose();
    } catch (error) {
      if (onError) {
        onError(error);
      } else {
        throw error;
      }
    }
  }, 0);
}
