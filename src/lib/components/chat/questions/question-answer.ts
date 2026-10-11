import type { Question } from '$shared/types/question-resource';

/** One entry per question, in transcript order, handed back by the wizard. */
export interface QuestionAnswer {
  question: Question;
  /** Labels of the selected options (selection order). */
  selectedLabels: string[];
  /** Trimmed free-form "Other" text ('' when none). */
  freeText: string;
  /** True when the question was explicitly skipped. */
  skipped: boolean;
  /** Transient pasted images, in paste order for this question. */
  imageBlocks?: Array<{ type: 'image'; data: string; mimeType: string }>;
}
