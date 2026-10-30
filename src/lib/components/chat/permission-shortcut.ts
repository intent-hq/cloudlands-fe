import { isTextEntryTarget } from '$lib/utils/text-entry';

export function shouldHandlePermissionShortcut(event: KeyboardEvent, enabled: boolean): boolean {
  return (
    enabled &&
    !event.defaultPrevented &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.altKey &&
    !isTextEntryTarget(event.target)
  );
}
