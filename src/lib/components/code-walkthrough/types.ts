/**
 * Code Walkthrough Types
 *
 * Types for the AI-powered code walkthrough feature that narrates through code changes.
 */

export type WalkthroughStatus = 'idle' | 'running' | 'complete' | 'error' | 'stale';

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

/** A file with its annotations grouped together */
export interface WalkthroughFile {
  path: string;
  annotations: WalkthroughAnnotation[];
  summary?: string;
}

/** The complete walkthrough result */
export interface CodeWalkthrough {
  id: string;
  workspaceId: string;
  timestamp: Date;
  status: WalkthroughStatus;

  /** Overall narrative summary */
  summary?: string;

  /** Ordered sections grouping related files */
  sections: WalkthroughSection[];

  /** All annotations indexed by file */
  files: WalkthroughFile[];

  /** Metadata */
  duration?: number;
  agentId?: string;
}

/** Parsed walkthrough from agent output */
export interface ParsedWalkthrough {
  summary: string;
  sections: Array<{
    title: string;
    description: string;
    files: string[];
  }>;
  annotations: Array<{
    file: string;
    line: number;
    endLine?: number;
    message: string;
    category: string;
    importance: string;
  }>;
}

/**
 * Parse walkthrough JSON from agent output
 */
export function parseWalkthroughResult(text: string): ParsedWalkthrough | null {
  try {
    // Try to find JSON in the response
    const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/);
    const jsonStr = jsonMatch ? jsonMatch[1] : text;

    const parsed = JSON.parse(jsonStr.trim());

    // Validate required fields
    if (!parsed.summary || !Array.isArray(parsed.sections) || !Array.isArray(parsed.annotations)) {
      return null;
    }

    return {
      summary: parsed.summary,
      sections: parsed.sections.map(
        (s: { title?: string; description?: string; files?: string[] }, i: number) => ({
          title: s.title || `Section ${i + 1}`,
          description: s.description || '',
          files: Array.isArray(s.files) ? s.files : [],
        }),
      ),
      annotations: parsed.annotations.map(
        (
          a: {
            file?: string;
            line?: number;
            endLine?: number;
            message?: string;
            category?: string;
            importance?: string;
          },
          i: number,
        ) => ({
          file: a.file || '',
          line: a.line || 1,
          endLine: a.endLine,
          message: a.message || '',
          category: a.category || 'explanation',
          importance: a.importance || 'medium',
        }),
      ),
    };
  } catch {
    return null;
  }
}

/**
 * Generate a unique ID for an annotation
 */
export function generateAnnotationId(file: string, line: number, index: number): string {
  return `walkthrough-${file.replace(/[^a-zA-Z0-9]/g, '-')}-${line}-${index}`;
}

/**
 * Group annotations by file path
 */
export function groupAnnotationsByFile(
  annotations: WalkthroughAnnotation[],
): Map<string, WalkthroughAnnotation[]> {
  const grouped = new Map<string, WalkthroughAnnotation[]>();

  for (const annotation of annotations) {
    const existing = grouped.get(annotation.file) || [];
    existing.push(annotation);
    grouped.set(annotation.file, existing);
  }

  // Sort annotations within each file by line number
  for (const [file, fileAnnotations] of grouped) {
    grouped.set(
      file,
      fileAnnotations.sort((a, b) => a.line - b.line),
    );
  }

  return grouped;
}
