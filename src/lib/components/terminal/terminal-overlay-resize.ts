import {
  clampTerminalOverlayHeight,
  terminalOverlayHeightFromPointer,
} from '$shared/utils/terminal-overlay-height';

interface TerminalOverlayResizeOptions {
  getHeight: () => number;
  setPreviewHeight: (height: number | null) => void;
  setResizing: (isResizing: boolean) => void;
  commitHeight: (height: number) => void;
}

export function createTerminalOverlayResize(options: TerminalOverlayResizeOptions): {
  start: (event: MouseEvent) => void;
  stop: () => void;
} {
  let isActive = false;
  let latestHeight: number | null = null;
  let bodyStyles: { cursor: string; userSelect: string } | null = null;

  const handleMove = (event: MouseEvent) => {
    if (!isActive) return;
    latestHeight = terminalOverlayHeightFromPointer(event.clientY, window.innerHeight);
    options.setPreviewHeight(latestHeight);
  };

  const stop = () => {
    if (!isActive) return;
    isActive = false;
    document.removeEventListener('mousemove', handleMove);
    document.removeEventListener('mouseup', stop);
    document.body.style.cursor = bodyStyles?.cursor ?? '';
    document.body.style.userSelect = bodyStyles?.userSelect ?? '';
    bodyStyles = null;
    options.setResizing(false);
    options.commitHeight(latestHeight ?? clampTerminalOverlayHeight(options.getHeight()));
    latestHeight = null;
    options.setPreviewHeight(null);
  };

  const start = (event: MouseEvent) => {
    event.preventDefault();
    if (isActive) return;
    isActive = true;
    latestHeight = clampTerminalOverlayHeight(options.getHeight());
    bodyStyles = {
      cursor: document.body.style.cursor,
      userSelect: document.body.style.userSelect,
    };
    options.setResizing(true);
    document.body.style.cursor = 'ns-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', stop);
  };

  return { start, stop };
}
