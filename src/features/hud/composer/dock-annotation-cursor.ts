import { DOCK_ANNOTATION_STYLE as INK } from './dock-annotation-style';

/** Existing Dock toolbar glyphs (Phosphor regular), with a source-point hotspot. */
function glyphCursor(body: string, x: number, y: number): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 256 256"><g fill="${INK.accent}" stroke="${INK.halo}" stroke-width="12" stroke-linejoin="round" paint-order="stroke fill">${body}</g></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${x} ${y}, crosshair`;
}
const PENCIL = glyphCursor(
  '<path d="M227.31,73.37,182.63,28.68a16,16,0,0,0-22.63,0L36.69,152A15.86,15.86,0,0,0,32,163.31V208a16,16,0,0,0,16,16H92.69A15.86,15.86,0,0,0,104,219.31L227.31,96a16,16,0,0,0,0-22.63ZM92.69,208H48V163.31l88-88L180.69,120ZM192,108.68,147.31,64l24-24L216,84.68Z"/>',
  3,
  21,
);
const BOX = glyphCursor(
  '<path d="M216,40H40A16,16,0,0,0,24,56V200a16,16,0,0,0,16,16H216a16,16,0,0,0,16-16V56A16,16,0,0,0,216,40Zm0,160H40V56H216V200Z"/>',
  3,
  5,
);
const ARROW = glyphCursor(
  '<path d="M200,64V168a8,8,0,0,1-16,0V83.31L69.66,197.66a8,8,0,0,1-11.32-11.32L172.69,72H88a8,8,0,0,1,0-16H192A8,8,0,0,1,200,64Z"/>',
  18,
  6,
);
const PICK = glyphCursor(
  '<path d="M88,24V16a8,8,0,0,1,16,0v8a8,8,0,0,1-16,0ZM16,104h8a8,8,0,0,0,0-16H16a8,8,0,0,0,0,16ZM124.42,39.16a8,8,0,0,0,10.74-3.58l8-16a8,8,0,0,0-14.31-7.16l-8,16A8,8,0,0,0,124.42,39.16Zm-96,81.69-16,8a8,8,0,0,0,7.16,14.31l16-8a8,8,0,1,0-7.16-14.31ZM219.31,184a16,16,0,0,1,0,22.63l-12.68,12.68a16,16,0,0,1-22.63,0L132.7,168,115,214.09c0,.1-.08.21-.13.32a15.83,15.83,0,0,1-14.6,9.59l-.79,0a15.83,15.83,0,0,1-14.41-11L32.8,52.92A16,16,0,0,1,52.92,32.8L213,85.07a16,16,0,0,1,1.41,29.8l-.32.13L168,132.69ZM208,195.31,156.69,144h0a16,16,0,0,1,4.93-26l.32-.14,45.95-17.64L48,48l52.2,159.86,17.65-46c0-.11.08-.22.13-.33a16,16,0,0,1,11.69-9.34,16.72,16.72,0,0,1,3-.28,16,16,0,0,1,11.3,4.69L195.31,208Z"/>',
  7,
  4,
);

/** Resize/move handles and native text fields keep their own descendant cursors. */
export function dockAnnotationCursor(tool: string | null | undefined): string {
  switch (tool) {
    case 'draw':
    case 'pen':
      return PENCIL;
    case 'box':
      return BOX;
    case 'arrow':
      return ARROW;
    case 'pick':
    case 'element':
      return PICK;
    case 'text':
      return 'text';
    case 'blur':
    case 'crop':
      return 'crosshair';
    default:
      return 'default';
  }
}
