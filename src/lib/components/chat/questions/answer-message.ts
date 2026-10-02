import type { ContentBlock } from '$shared/types';
import type { Question } from '$shared/types/question-resource';

/**
 * Answer flattening for the Agent Q&A wizard (wire contract): all answers of
 * a question set collapse into ONE plain-text user message of `Q:`/`A:`
 * pairs separated by a blank line — multi-select answers comma-joined,
 * free-form replies prefixed `(Other)`, skipped questions reported as
 * `(skipped)`. The message travels through the ordinary `agent.sendMessage`
 * path tagged with `messageMetadata { type: "question_answers",
 * answeredQuestionsMessageId }` — the structured tag (never the answer text)
 * is what resolves the pending set, on the daemon and in every FE derivation.
 * Dependency-light on purpose — no stores, no components.
 */

/** One entry per question, in transcript order, handed back by the wizard. */
export interface QuestionAnswer {
  question: Question;
  /** Labels of the selected options (selection order). */
  selectedLabels: string[];
  /** Trimmed free-form "Other" text ('' when none). */
  freeText: string;
  /** True when the question was explicitly skipped. */
  skipped: boolean;
}

function formatAnswer(answer: QuestionAnswer): string {
  if (answer.skipped) return '(skipped)';
  const parts = [...answer.selectedLabels];
  if (answer.freeText) parts.push(`(Other) ${answer.freeText}`);
  // A question left unanswered without an explicit Skip (only reachable via
  // Back-then-Send edge flows) reads the same as a skip on the wire.
  if (parts.length === 0) return '(skipped)';
  return parts.join(', ');
}

/** Flatten the wizard's answers into the single plain-text user message. */
export function flattenAnswersToMessage(answers: readonly QuestionAnswer[]): string {
  return answers.map((a) => `Q: ${a.question.question}\nA: ${formatAnswer(a)}`).join('\n\n');
}

/** `messageMetadata.type` marking a wizard answer message. */
const QUESTION_ANSWERS_METADATA_TYPE = 'question_answers';

/** The answer tag carried on the wizard's `agent.sendMessage` request. */
export type QuestionAnswersMetadata = {
  type: typeof QUESTION_ANSWERS_METADATA_TYPE;
  /** Id of the question-bearing assistant message these answers resolve. */
  answeredQuestionsMessageId: string;
};

/** Build the answer tag for the question set the wizard just completed. */
export function buildAnswerMessageMetadata(
  answeredQuestionsMessageId: string,
): QuestionAnswersMetadata {
  return { type: QUESTION_ANSWERS_METADATA_TYPE, answeredQuestionsMessageId };
}

interface AnswerMessageLike {
  metadata?: Record<string, unknown> | null;
  contentBlocks?: ContentBlock[];
}

function answeredIdFromMetadata(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const md = metadata as Record<string, unknown>;
  if (md.type !== QUESTION_ANSWERS_METADATA_TYPE) return null;
  const answered = md.answeredQuestionsMessageId;
  return typeof answered === 'string' && answered.length > 0 ? answered : null;
}

/** IDs answered by all contributions to a merged human message. */
function answeredIdsFromMetadata(metadata: unknown): string[] {
  const id = answeredIdFromMetadata(metadata);
  const ids = id ? [id] : [];
  if (metadata && typeof metadata === 'object' && 'mergedMessageMetadata' in metadata) {
    const contributions = metadata.mergedMessageMetadata;
    if (Array.isArray(contributions)) {
      for (const contribution of contributions) {
        const answered = answeredIdFromMetadata(contribution);
        if (answered && !ids.includes(answered)) ids.push(answered);
      }
    }
  }
  return ids;
}

/** Row metadata is authoritative, with text-block metadata as the legacy fallback. */
export function getAnsweredQuestionsMessageIds(
  message: AnswerMessageLike | null | undefined,
): string[] {
  if (!message) return [];
  const fromRow = answeredIdsFromMetadata(message.metadata);
  if (fromRow.length) return fromRow;
  const blocks = Array.isArray(message.contentBlocks) ? message.contentBlocks : [];
  return [
    ...new Set(
      blocks.flatMap((block) =>
        block.type === 'text' ? answeredIdsFromMetadata(block.messageMetadata) : [],
      ),
    ),
  ];
}
