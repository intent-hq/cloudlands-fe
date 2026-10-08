import type { CustomView, CustomViewInput, CustomViewRuntime } from '$shared/types/custom-views';

export function validCustomViewInput(input: CustomViewInput): boolean {
  return Boolean(
    input.name.trim() &&
    input.directory.trim() &&
    input.command.trim() &&
    Number.isInteger(input.port) &&
    input.port >= 1024 &&
    input.port <= 65535,
  );
}

/** Never turn a malformed runtime response into an arbitrary iframe navigation. */
export function customViewFrameUrl(
  view: CustomView,
  runtime: CustomViewRuntime | undefined,
): string | null {
  const expected = `http://127.0.0.1:${view.port}/`;
  return runtime?.status === 'running' && runtime.url === expected ? expected : null;
}
