/**
 * Message-authorship core predicate, shared by the queue surface
 * (`isUserQueuedMessage` in queued-message-visibility.ts, reads
 * `messageMetadata`) and the transcript surface (`isAutomatedChatMessage`
 * in previous-user-message.ts, reads `metadata`) so the rules cannot drift.
 *
 * User-typed messages never carry an origin tag; daemon-origin messages
 * (agent-to-agent sends, event-notification wakes, hook wakes, PR-monitor
 * wakes, system wakes) carry metadata with a `type` string, a daemon-stamped
 * `fromAgentId`, or `source: 'system'` (PROTOCOL §5.5). Benign fields that
 * can appear on user messages (`model`, `userAppMessageId`, `queueInfo`) do
 * not mark a message as non-user. Absent or malformed metadata means
 * user-authored (fail open). Dependency-light on purpose: no imports.
 */

/**
 * True when a metadata object marks its message as user-authored. A message
 * is NON-user iff the metadata is an object and any of: `type` is a string
 * (except the user-authored `question_answers` wizard tag), `fromAgentId`
 * is a non-empty string, or `source === 'system'`.
 */
export function isUserAuthoredMetadata(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== 'object') return true;
  const md = metadata as Record<string, unknown>;
  // Explicit contract pin for dismissal notifications (`agent.dismissQuestions`,
  // `{ type: 'questions_dismissed', source: 'system', dismissedQuestionsMessageId }`).
  // Redundant with the generic string-`type` rule below, kept as belt-and-braces.
  if (md.type === 'questions_dismissed') return false;
  // The Q&A wizard's answer message is USER-authored despite its tag
  // (`{ type: 'question_answers', answeredQuestionsMessageId }`, see
  // questions/answer-message.ts): it travels through the ordinary send path,
  // so it stays user-authored regardless of the other markers.
  if (md.type === 'question_answers') return true;
  if (typeof md.type === 'string') return false;
  if (typeof md.fromAgentId === 'string' && md.fromAgentId.trim() !== '') return false;
  if (md.source === 'system') return false;
  return true;
}
