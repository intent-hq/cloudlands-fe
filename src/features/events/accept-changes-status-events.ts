const ACCEPT_CHANGES_STATUS_EVENT_FAMILIES = ['git:', 'pr:'] as const;
const ACCEPT_CHANGES_STATUS_EVENT_TYPES = ['changes:git-status'] as const;

export function isAcceptChangesStatusEvent(type: string): boolean {
  return (
    ACCEPT_CHANGES_STATUS_EVENT_FAMILIES.some((prefix) => type.startsWith(prefix)) ||
    ACCEPT_CHANGES_STATUS_EVENT_TYPES.includes(
      type as (typeof ACCEPT_CHANGES_STATUS_EVENT_TYPES)[number],
    )
  );
}
