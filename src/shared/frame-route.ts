/**
 * The frame page: what an app window's own web contents loads. It only paints
 * the shell backdrop under the window's machine views (see main/frames.ts),
 * so it boots without the app store or a backend connection.
 */
export const FRAME_ROUTE = '/frame';

export function isFrameRoute(pathname: string): boolean {
  return pathname === FRAME_ROUTE || pathname === `${FRAME_ROUTE}/`;
}
