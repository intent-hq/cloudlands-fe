/**
 * Agent Q&A question resource (PROTOCOL §7.1 standalone resource block).
 * The daemon attaches one resource block per `ws.app.question.ask` call as a
 * trailing block on the turn's final assistant message. There is NO
 * questionId — pending vs. answered is derived purely from whether a later
 * user message exists after the question-bearing assistant message.
 *
 * Questions are WIZARD-ONLY on the FE: they never render in the conversation
 * transcript (pending or resolved) — the composer-slot QuestionWizard is the
 * sole rendering surface (see `derivePendingQuestions`). Transcript renderers
 * use `isQuestionResourceBlock` to strip them.
 */
export const QUESTION_RESOURCE_MIME_TYPE = 'application/vnd.intent.question+json';

export const QUESTION_RESOURCE_URI_SCHEME = 'intent-question';

export interface QuestionOption {
  label: string;
  description?: string;
}

export interface Question {
  /** Turn-attachment registry id (`tar-…`) stamped by the daemon. */
  attachmentId: string;
  /** Short category label rendered above the question (e.g. "Auth method"). */
  header: string;
  question: string;
  /** Optional longer context shown expandable. */
  explanation?: string;
  /** At least 2 options; free-form "Other" is implicit (always offered by the FE). */
  options: QuestionOption[];
  multiSelect?: boolean;
}

function isQuestionOption(value: unknown): value is QuestionOption {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<QuestionOption>;
  return (
    typeof candidate.label === 'string' &&
    candidate.label.length > 0 &&
    (candidate.description === undefined || typeof candidate.description === 'string')
  );
}

export function isQuestion(value: unknown): value is Question {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<Question>;
  return (
    typeof candidate.attachmentId === 'string' &&
    typeof candidate.header === 'string' &&
    candidate.header.length > 0 &&
    typeof candidate.question === 'string' &&
    candidate.question.length > 0 &&
    (candidate.explanation === undefined || typeof candidate.explanation === 'string') &&
    Array.isArray(candidate.options) &&
    candidate.options.length >= 2 &&
    candidate.options.every(isQuestionOption) &&
    (candidate.multiSelect === undefined || typeof candidate.multiSelect === 'boolean')
  );
}

/**
 * Whether a content block is a §7.1 standalone question resource block
 * (question MIME). Payload validity is irrelevant here: even a malformed
 * question payload must not surface in the transcript, so the check is
 * MIME-only. Used by MessageContent / StreamingMessageContent to strip
 * question blocks from transcript rendering (wizard-only surface).
 */
export function isQuestionResourceBlock(block: unknown): boolean {
  if (!block || typeof block !== 'object') return false;
  const candidate = block as { type?: unknown; resource?: unknown };
  if (candidate.type !== 'resource') return false;
  const resource = candidate.resource as { mimeType?: unknown } | null | undefined;
  return (
    typeof resource === 'object' &&
    resource !== null &&
    resource.mimeType === QUESTION_RESOURCE_MIME_TYPE
  );
}

export function getQuestionFromResourceBlock(block: unknown): Question | null {
  if (!block || typeof block !== 'object') return null;
  const candidate = block as Record<string, any>;
  const resource = candidate.resource ?? candidate.metadata?.resource ?? candidate;

  if (
    !resource ||
    typeof resource !== 'object' ||
    resource.mimeType !== QUESTION_RESOURCE_MIME_TYPE ||
    typeof resource.text !== 'string'
  ) {
    return null;
  }

  try {
    const question = JSON.parse(resource.text);
    return isQuestion(question) ? question : null;
  } catch {
    return null;
  }
}
