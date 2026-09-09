export type AnnotationCategory = 'explanation' | 'context' | 'rationale' | 'warning' | 'highlight';

export type AnnotationImportance = 'high' | 'medium' | 'low';

/** A single annotation attached to a line in a file */
export interface WalkthroughAnnotation {
  id: string;
  file: string;
  line: number;
  endLine?: number;
  message: string;
  category: AnnotationCategory;
  importance: AnnotationImportance;
}

/** A section of the walkthrough covering a group of related files */
export interface WalkthroughSection {
  title: string;
  description: string;
  files: string[];
  order?: number;
}

/** Walkthrough data parsed from agent output */
export interface WalkthroughData {
  summary: string;
  sections: WalkthroughSection[];
  annotations: WalkthroughAnnotation[];
}
