/**
 * Question-dismissal predicate (PROTOCOL §5.5 dismissal marker).
 *
 * The daemon persists the id of the question-bearing message the user
 * dismissed under `metadata.dismissedQuestionsMessageId` (`agent.dismissQuestions`;
 * survives reload). A question whose message id equals that marker is no
 * longer pending. Shared by the chat composer's wizard gate and the HUD's
 * pending-question derivation so both retire the indicator on the exact same
 * signal rather than reinventing it. Dependency-light on purpose (no stores).
 */
export function isQuestionMessageDismissed(
  metadata: Record<string, unknown> | null | undefined,
  messageId: string | null | undefined,
): boolean {
  if (typeof messageId !== 'string' || messageId.length === 0) return false;
  const dismissedId = metadata?.dismissedQuestionsMessageId;
  return typeof dismissedId === 'string' && dismissedId === messageId;
}
