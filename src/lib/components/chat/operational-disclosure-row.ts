import { safeSlide } from '$lib/utils/animations';
import { prefersReducedMotion } from '$lib/utils/reduced-motion';
import { createOperationalDetailsTransition } from '$lib/utils/safe-slide-core';

export {
  isOperationalClusterBlock,
  isAdjacentOperationalClusterRow,
  getOperationalClusterSpacingClass,
  getOperationalGroupContentSpacingClass,
} from './operational-cluster-projections';

export {
  OPERATIONAL_ROW_GEOMETRY_TOKENS_CLASS,
  OPERATIONAL_ROW_TONE_CLASS,
  OPERATIONAL_ASSISTANT_PROSE_INSET_CLASS,
  OPERATIONAL_EXPANDED_CONTENT_CLASS,
  OPERATIONAL_INLINE_DETAILS_CLASS,
  OPERATIONAL_GROUP_CONTENT_CLASS,
  OPERATIONAL_GROUP_CHILD_CONTENT_CLASS,
  OPERATIONAL_GROUP_CHILD_ROW_CLASS,
  NESTED_REASONING_SECTION_SEAM_CLASS,
  OPERATIONAL_PRIMARY_CLASS,
  OPERATIONAL_SECONDARY_CLASS,
  CHAT_OPERATIONAL_SUMMARY_TONE_CLASS,
  CHAT_OPERATIONAL_CONTAINER_CLASS,
  CHAT_OPERATIONAL_ICON_CLASS,
  CHAT_OPERATIONAL_ROW_CLASS,
  CHAT_OPERATIONAL_LEADING_CLASS,
  CHAT_OPERATIONAL_SUMMARY_CLASS,
  CHAT_OPERATIONAL_TRAILING_CLASS,
  CHAT_OPERATIONAL_CHEVRON_CLASS,
  COMPACT_TOOL_TRAILING_CLASS,
} from './operational-disclosure-classes';

/** Temporary Svelte compatibility binding, retained until the source renderer retires. */
export const safeOperationalDetailsTransition = createOperationalDetailsTransition({
  safeSlide,
  prefersReducedMotion,
});
