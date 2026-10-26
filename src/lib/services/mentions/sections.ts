import { m } from '$shared/paraglide/messages.js';
import type { MentionCandidate, MentionGroup, MentionType } from './types';
import { isMentionGroup } from './types';

export interface MentionSection {
  /** Stable key: the kind, or `other` for unlisted kinds and drill-in groups. */
  key: string;
  label: string;
  items: (MentionCandidate | MentionGroup)[];
}

const SECTION_LABELS: Partial<Record<MentionType, () => string>> = {
  member: m.chat_mentions_section_people,
  note: m.chat_mentions_section_notes,
  agent: m.chat_mentions_section_agents,
  file: m.chat_mentions_section_files,
  folder: m.chat_mentions_section_folders,
  script: m.chat_mentions_section_scripts,
  terminal: m.chat_mentions_section_terminals,
  specialist: m.chat_mentions_section_specialists,
};

const OTHER_SECTION = 'other';

function sectionKey(item: MentionCandidate | MentionGroup): string {
  if (isMentionGroup(item)) return OTHER_SECTION;
  return item.type in SECTION_LABELS ? item.type : OTHER_SECTION;
}

/**
 * Split @-menu results into one section per kind, in the order each kind
 * first appears (the search already ranks by kind). Within a section, items
 * stay grouped by their provider label in first-appearance order, so files
 * keep their recent → most relevant → other sub-order under one heading.
 */
export function buildMentionSections(
  items: readonly (MentionCandidate | MentionGroup)[],
): MentionSection[] {
  const sections = new Map<string, Map<string, (MentionCandidate | MentionGroup)[]>>();
  for (const item of items) {
    const key = sectionKey(item);
    const buckets = sections.get(key) ?? new Map<string, (MentionCandidate | MentionGroup)[]>();
    sections.set(key, buckets);
    const bucketKey = isMentionGroup(item) ? '\u0000group' : `${item.type}:${item.group ?? ''}`;
    const bucket = buckets.get(bucketKey) ?? [];
    buckets.set(bucketKey, bucket);
    bucket.push(item);
  }
  return Array.from(sections, ([key, buckets]) => ({
    key,
    label: (SECTION_LABELS[key as MentionType] ?? m.chat_mentions_section_other)(),
    items: Array.from(buckets.values()).flat(),
  }));
}
