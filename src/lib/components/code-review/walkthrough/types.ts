/**
 * Types for the code walkthrough feature
 */

/** Annotation type determines visual styling and icon */
export type WalkthroughAnnotationType = 'explanation' | 'context' | 'highlight';

/** Status of the walkthrough generation */
export type WalkthroughStatus = 'idle' | 'running' | 'complete' | 'error';

/** A single annotation in the walkthrough narrative */
export interface WalkthroughAnnotation {
  /** File path relative to repository root */
  file: string;
  /** Starting line number */
  line: number;
  /** Ending line number (optional, for multi-line annotations) */
  endLine?: number;
  /** The explanation/narration text (supports markdown) */
  message: string;
  /** Type of annotation for styling */
  type: WalkthroughAnnotationType;
}

/** A file in a walkthrough category */
export interface WalkthroughFile {
  /** File path relative to repository root */
  path: string;
  /** Brief summary of what changed in this file */
  summary?: string;
  /** Annotations specific to this file */
  annotations: WalkthroughAnnotation[];
}

/** A category grouping related changes */
export interface WalkthroughCategory {
  /** Category title (e.g., "Moves AsyncQueue to shared library") */
  title: string;
  /** Brief description of what this category encompasses */
  description: string;
  /** Files in this category */
  files: WalkthroughFile[];
}

/** The complete walkthrough structure */
export interface CodeWalkthrough {
  /** Brief title for the walkthrough */
  title: string;
  /** High-level overview of what the changes accomplish */
  overview: string;
  /** Ordered list of annotations forming the narrative (legacy, for backwards compat) */
  annotations: WalkthroughAnnotation[];
  /** Categories grouping related files (preferred structure) */
  categories?: WalkthroughCategory[];
}

/** JSON output format from the agent - annotation format */
interface JsonAnnotation {
  file: string;
  line: number;
  endLine?: number;
  message: string;
  type: string;
}

/** JSON output format from the agent - file format */
interface JsonFile {
  path: string;
  summary?: string;
  annotations?: JsonAnnotation[];
}

/** JSON output format from the agent - category format */
interface JsonCategory {
  title: string;
  description: string;
  files?: JsonFile[];
}

/** JSON output format from the agent */
interface JsonWalkthroughOutput {
  title: string;
  overview: string;
  annotations?: JsonAnnotation[];
  categories?: JsonCategory[];
}

/**
 * Parse walkthrough JSON from agent output
 */
export function parseWalkthrough(text: string): CodeWalkthrough | null {
  // Extract content from <CODE_WALKTHROUGH> tags if present
  const tagMatch = text.match(/<CODE_WALKTHROUGH[^>]*>([\s\S]*?)<\/CODE_WALKTHROUGH>/i);
  const content = tagMatch ? tagMatch[1] : text;

  // Try direct JSON parse first (prompt asks for raw JSON)
  try {
    const trimmed = content.trim();
    if (trimmed.startsWith('{')) {
      const parsed = JSON.parse(trimmed) as JsonWalkthroughOutput;
      return normalizeWalkthrough(parsed);
    }
  } catch {
    // Continue to other methods
  }

  // Try to find JSON in code blocks
  const jsonBlockMatch = content.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (jsonBlockMatch) {
    try {
      const parsed = JSON.parse(jsonBlockMatch[1].trim()) as JsonWalkthroughOutput;
      return normalizeWalkthrough(parsed);
    } catch {
      // Continue to other methods
    }
  }

  // Try to find raw JSON object anywhere in text (look for title + either annotations or categories)
  const jsonMatch = content.match(
    /\{[\s\S]*?"title"[\s\S]*?("annotations"|"categories")[\s\S]*?\}/,
  );
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]) as JsonWalkthroughOutput;
      return normalizeWalkthrough(parsed);
    } catch {
      // Not valid JSON
    }
  }

  console.warn('[parseWalkthrough] Failed to parse:', content.substring(0, 200));
  return null;
}

const validTypes: WalkthroughAnnotationType[] = ['explanation', 'context', 'highlight'];

/**
 * Normalize a single annotation
 */
function normalizeAnnotation(a: JsonAnnotation): WalkthroughAnnotation {
  return {
    file: a.file,
    line: a.line,
    endLine: a.endLine,
    message: a.message,
    type: validTypes.includes(a.type as WalkthroughAnnotationType)
      ? (a.type as WalkthroughAnnotationType)
      : 'explanation',
  };
}

/**
 * Normalize and validate the parsed walkthrough
 */
function normalizeWalkthrough(raw: JsonWalkthroughOutput): CodeWalkthrough | null {
  if (!raw.title || !raw.overview) {
    return null;
  }

  // Handle categories if present
  let categories: WalkthroughCategory[] | undefined;
  if (raw.categories && Array.isArray(raw.categories)) {
    categories = raw.categories
      .filter((c) => c.title && c.description)
      .map((c) => ({
        title: c.title,
        description: c.description,
        files: (c.files || [])
          .filter((f) => f.path)
          .map((f) => ({
            path: f.path,
            summary: f.summary,
            annotations: (f.annotations || [])
              .filter((a) => a.file && typeof a.line === 'number' && a.message)
              .map(normalizeAnnotation),
          })),
      }));
  }

  // Handle flat annotations (legacy format or if categories not present)
  let annotations: WalkthroughAnnotation[] = [];
  if (raw.annotations && Array.isArray(raw.annotations)) {
    annotations = raw.annotations
      .filter((a) => a.file && typeof a.line === 'number' && a.message)
      .map(normalizeAnnotation);
  }

  // If we have categories but no flat annotations, flatten them for backwards compat
  if (categories && categories.length > 0 && annotations.length === 0) {
    annotations = categories.flatMap((c) => c.files.flatMap((f) => f.annotations));
  }

  // If we have annotations but no categories, create a default category
  if (annotations.length > 0 && (!categories || categories.length === 0)) {
    // Group by file
    const fileMap = new Map<string, WalkthroughAnnotation[]>();
    for (const ann of annotations) {
      const existing = fileMap.get(ann.file) || [];
      existing.push(ann);
      fileMap.set(ann.file, existing);
    }

    categories = [
      {
        title: raw.title,
        description: raw.overview,
        files: Array.from(fileMap.entries()).map(([path, anns]) => ({
          path,
          annotations: anns,
        })),
      },
    ];
  }

  return {
    title: raw.title,
    overview: raw.overview,
    annotations,
    categories,
  };
}
