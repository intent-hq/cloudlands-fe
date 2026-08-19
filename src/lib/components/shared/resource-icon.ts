import type { IconDefinition } from '@fortawesome/fontawesome-common-types';
import { faAlignLeft, faCode } from '@fortawesome/free-solid-svg-icons';

export type ResourceIconKind = 'note' | 'changes';

export const RESOURCE_ICON_BY_KIND = {
  note: faAlignLeft,
  changes: faCode,
} satisfies Record<ResourceIconKind, IconDefinition>;

const RESOURCE_KIND_BY_TAB_TYPE: Record<string, ResourceIconKind> = {
  note: 'note',
  changes: 'changes',
  'local-changes': 'changes',
  'chat-changes': 'changes',
  'activity-changes': 'changes',
};

export function getResourceIconKind(type: string): ResourceIconKind | null {
  return RESOURCE_KIND_BY_TAB_TYPE[type] ?? null;
}
