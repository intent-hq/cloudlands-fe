/**
 * Wrap a navigation fake (`goto` or `navigateToRoute`) so the window ends up
 * on the route before the fake runs, like the real navigation. The workspace
 * jump helper (`$lib/utils/show-workspace`) opens a tab only once the window
 * is on the target workspace, so fakes that never move the URL would read as
 * an overtaken jump. The fake still records every call and keeps its own
 * implementation (including rejections).
 */
export function landingNavigation<Args extends unknown[], Result>(
  fake: (route: string, ...rest: Args) => Result,
): (route: string, ...rest: Args) => Result {
  return (route, ...rest) => {
    if (typeof window !== 'undefined') window.history.pushState({}, '', route);
    return fake(route, ...rest);
  };
}
