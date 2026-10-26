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
  member: m.chat_mentionList_peopleSection_label,
  note: m.chat_mentionList_notesSection_label,
  agent: m.chat_mentionList_agentsSection_label,
  file: m.chat_mentionList_filesSection_label,
  folder: m.chat_mentionList_foldersSection_label,
  script: m.chat_mentionList_scriptsSection_label,
  terminal: m.chat_mentionList_terminalsSection_label,
  specialist: m.chat_mentionList_specialistsSection_label,
};

const OTHER_SECTION = 'other';

function sectionKey(item: MentionCandidate | MentionGroup): string {
  if (isMentionGroup(item)) return OTHER_SECTION;
  return item.type in SECTION_LABELS ? item.type : OTHER_SECTION;
}

/**
 * Split @-menu results into one section per kind, in the order each kind
 * first appears (the search already ranks by kind; unlisted kinds share the
 * same rank slot, so they form one contiguous "Other" section). Items keep
 * their input order within a section.
 */
export function buildMentionSections(
  items: readonly (MentionCandidate | MentionGroup)[],
): MentionSection[] {
  const sections = new Map<string, (MentionCandidate | MentionGroup)[]>();
  for (const item of items) {
    const key = sectionKey(item);
    const section = sections.get(key) ?? [];
    sections.set(key, section);
    section.push(item);
  }
  return Array.from(sections, ([key, sectionItems]) => ({
    key,
    label: (SECTION_LABELS[key as MentionType] ?? m.chat_mentionList_otherSection_label)(),
    items: sectionItems,
  }));
}
