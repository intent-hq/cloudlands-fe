/**
 * Code Review Types
 *
 * Types for the AI-powered code review feature
 */

import { m } from '$shared/paraglide/messages.js';

export type ReviewStatus = 'idle' | 'running' | 'complete' | 'error' | 'stale';

export type ReviewSeverity = 'critical' | 'important' | 'minor';

export type ReviewCategory = 'bug' | 'security' | 'api' | 'documentation' | 'other';

export interface ReviewLocation {
  file: string;
  startLine: number;
  endLine?: number;
}

export interface ReviewComment {
  id: string;
  severity: ReviewSeverity;
  category: ReviewCategory;
  title: string;
  description: string;
  location?: ReviewLocation;
  confidence: number; // 0-1

  // UI state (local, not from agent)
  dismissed?: boolean;
  pinned?: boolean;
}

export interface ReviewSnapshot {
  stagedFiles: string[];
  commitHashes?: string[];
  baseRef?: string;
}

export interface CodeReview {
  id: string;
  workspaceId: string;
  timestamp: Date;
  status: ReviewStatus;

  // Snapshot of what was reviewed
  snapshot: ReviewSnapshot;

  // Results
  summary?: string;
  comments: ReviewComment[];

  // Metadata
  duration?: number;
  agentId?: string;
}

/**
 * Severity display configuration
 */
export const SEVERITY_CONFIG: Record<
  ReviewSeverity,
  {
    label: string;
    color: string;
    bgColor: string;
    borderColor: string;
    icon: string;
  }
> = {
  critical: {
    get label() {
      return m.codeReview_types_severityCritical_label();
    },
    color: 'text-red-600 dark:text-red-400',
    bgColor: 'bg-red-50 dark:bg-red-950/30',
    borderColor: 'border-red-200 dark:border-red-800',
    icon: '🔴',
  },
  important: {
    get label() {
      return m.codeReview_types_severityImportant_label();
    },
    color: 'text-amber-600 dark:text-amber-400',
    bgColor: 'bg-amber-50 dark:bg-amber-950/30',
    borderColor: 'border-amber-200 dark:border-amber-800',
    icon: '🟡',
  },
  minor: {
    get label() {
      return m.codeReview_types_severityMinor_label();
    },
    color: 'text-blue-600 dark:text-blue-400',
    bgColor: 'bg-blue-50 dark:bg-blue-950/30',
    borderColor: 'border-blue-200 dark:border-blue-800',
    icon: '🔵',
  },
};

/**
 * Category display labels
 */
export const CATEGORY_LABELS: Record<ReviewCategory, string> = {
  get bug() {
    return m.codeReview_types_categoryBug_label();
  },
  get security() {
    return m.codeReview_types_categorySecurity_label();
  },
  get api() {
    return m.codeReview_types_categoryApi_label();
  },
  get documentation() {
    return m.codeReview_types_categoryDocumentation_label();
  },
  get other() {
    return m.codeReview_types_categoryOther_label();
  },
};

/**
 * Category icons (FontAwesome icon names)
 */
export const CATEGORY_ICONS: Record<ReviewCategory, string> = {
  bug: 'faBug',
  security: 'faShield',
  api: 'faPlug',
  documentation: 'faFileLines',
  other: 'faCircle',
};

/**
 * JSON format from the new prompt output
 */
interface JsonReviewOutput {
  summary: string;
  issues: Array<{
    severity: 'critical' | 'important' | 'minor';
    file: string;
    line: number;
    endLine?: number;
    title: string;
    description: string;
  }>;
}

/**
 * Try to extract and parse JSON from review text
 */
function tryParseJsonReview(text: string): JsonReviewOutput | null {
  // First, extract content from <CODE_REVIEW> tags if present
  const codeReviewMatch = text.match(/<CODE_REVIEW[^>]*>([\s\S]*?)<\/CODE_REVIEW>/i);
  const content = codeReviewMatch ? codeReviewMatch[1] : text;

  // Try direct JSON parse first (if content starts with {)
  const trimmed = content.trim();
  if (trimmed.startsWith('{')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      // Continue to other methods
    }
  }

  // Try to find JSON in code blocks (handles ```json ... ``` format)
  const jsonBlockMatch = content.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (jsonBlockMatch) {
    try {
      return JSON.parse(jsonBlockMatch[1].trim());
    } catch {
      // Not valid JSON, continue to other methods
    }
  }

  // Try to find raw JSON object with summary and issues
  const jsonMatch = content.match(/\{[\s\S]*"summary"[\s\S]*"issues"[\s\S]*\}/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[0]);
    } catch {
      // Not valid JSON
    }
  }

  console.warn('[tryParseJsonReview] Failed to parse:', content.substring(0, 200));
  return null;
}

/**
 * Parse streaming review output into structured data
 *
 * Supports three formats (in order of preference):
 * 1. JSON format (new): { "summary": "...", "issues": [...] }
 * 2. Pipe-delimited: **Critical** | Security | src/file.ts:42
 * 3. Inline (legacy): - **[Severity]** File:line - Brief description
 */
export function parseReviewComment(text: string): ReviewComment | null {
  // Try Format 1: Pipe-delimited format
  // **Critical** | Security | src/file.ts:42
  // Title of the issue
  // Description...
  const pipeMatch = text.match(/\*\*(Critical|Important|Minor)\*\*\s*\|\s*(\w+)\s*\|\s*([^\n]+)/i);

  if (pipeMatch) {
    const [, severityStr, categoryStr, locationStr] = pipeMatch;
    const severity = severityStr.toLowerCase() as ReviewSeverity;
    const category = (categoryStr.toLowerCase() as ReviewCategory) || 'other';

    // Parse location (file:line or file:startLine-endLine)
    let location: ReviewLocation | undefined;
    const locationMatch = locationStr.match(/([^:]+):(\d+)(?:-(\d+))?/);
    if (locationMatch) {
      location = {
        file: locationMatch[1].trim(),
        startLine: parseInt(locationMatch[2], 10),
        endLine: locationMatch[3] ? parseInt(locationMatch[3], 10) : undefined,
      };
    }

    // Extract title and description (after the header line)
    const contentAfterHeader = text.substring(text.indexOf('\n') + 1).trim();
    const lines = contentAfterHeader.split('\n');
    const title = lines[0]?.trim() || m.codeReview_types_untitled_fallback();
    const description = lines.slice(1).join('\n').trim();

    return {
      id: crypto.randomUUID(),
      severity,
      category,
      title,
      description,
      location,
      confidence: 0.8,
    };
  }

  // Try Format 2: Inline format from the actual prompt output
  // - **[Severity]** File:line - Brief description
  // or: **Important** - `file.tsx:24` - Description of the issue
  const inlineMatch = text.match(
    /[-*]?\s*\*\*(Critical|Important|Minor)\*\*\s*[-–]?\s*`?([^:`\s]+(?:\.[a-z]+)?):(\d+)(?:-(\d+))?`?\s*[-–]?\s*(.+)/i,
  );

  if (inlineMatch) {
    const [, severityStr, file, startLine, endLine, description] = inlineMatch;
    const severity = severityStr.toLowerCase() as ReviewSeverity;

    // Extract a title from the first sentence of the description
    const descParts = description.split(/[.!?]\s/);
    const title = descParts[0]?.trim() || m.codeReview_types_issueFound_fallback();
    const fullDescription = description.trim();

    return {
      id: crypto.randomUUID(),
      severity,
      category: 'other' as ReviewCategory, // Inline format doesn't include category
      title,
      description: fullDescription,
      location: {
        file: file.trim(),
        startLine: parseInt(startLine, 10),
        endLine: endLine ? parseInt(endLine, 10) : undefined,
      },
      confidence: 0.8,
    };
  }

  return null;
}

/**
 * Parse all review comments from a complete review result
 * Tries JSON format first, then falls back to legacy markdown formats
 */
export function parseAllReviewComments(reviewText: string): ReviewComment[] {
  // Try JSON format first (new structured format)
  const jsonReview = tryParseJsonReview(reviewText);
  if (jsonReview && Array.isArray(jsonReview.issues)) {
    return jsonReview.issues.map((issue) => ({
      id: crypto.randomUUID(),
      severity: issue.severity as ReviewSeverity,
      category: 'other' as ReviewCategory, // JSON format doesn't include category
      title: issue.title || m.codeReview_types_issueFound_fallback(),
      description: issue.description || '',
      location: issue.file
        ? {
          file: issue.file,
          startLine: issue.line,
          endLine: issue.endLine,
        }
        : undefined,
      confidence: 0.9, // Higher confidence for structured JSON output
    }));
  }

  // Fall back to legacy markdown parsing
  const comments: ReviewComment[] = [];

  // Pattern 1: Pipe-delimited format (multi-line)
  const pipePattern =
    /\*\*(Critical|Important|Minor)\*\*\s*\|[^\n]+(?:\n(?!\*\*(Critical|Important|Minor)\*\*|\s*[-*]\s*\*\*)[^\n]*)*/gi;
  const pipeMatches = reviewText.matchAll(pipePattern);

  for (const match of pipeMatches) {
    const comment = parseReviewComment(match[0]);
    if (comment) {
      comments.push(comment);
    }
  }

  // Pattern 2: Inline format (single line per issue)
  // Matches: - **Severity** file:line - description
  // i18n-ignore (scanner false positive: backticks in regex literals confuse the string tracker)
  // or: **Important** - `file.tsx:24` - Description
  const inlinePattern =
    /[-*]?\s*\*\*(Critical|Important|Minor)\*\*\s*[-–]?\s*`?[^:`\s]+(?:\.[a-z]+)?:\d+(?:-\d+)?`?\s*[-–]?\s*[^\n]+/gi;
  const inlineMatches = reviewText.matchAll(inlinePattern);

  for (const match of inlineMatches) {
    // Skip if we already parsed this as a pipe format
    const alreadyParsed = comments.some((c) => match[0].includes(c.title));
    if (!alreadyParsed) {
      const comment = parseReviewComment(match[0]);
      if (comment) {
        comments.push(comment);
      }
    }
  }

  return comments;
}

/**
 * Extract summary from review text
 * Works with both JSON and markdown formats
 */
export function parseReviewSummary(reviewText: string): string | null {
  // Try JSON format first
  const jsonReview = tryParseJsonReview(reviewText);
  if (jsonReview?.summary) {
    return jsonReview.summary;
  }

  // Fall back to markdown format - look for ### Summary section
  const summaryMatch = reviewText.match(/###\s*Summary\s*\n+([^\n#]+)/i);
  if (summaryMatch) {
    return summaryMatch[1].trim();
  }

  return null;
}

/**
 * Get review statistics from parsed comments
 */
export function getReviewStats(comments: ReviewComment[]): {
  total: number;
  hasCritical: boolean;
  criticalCount: number;
  importantCount: number;
  minorCount: number;
} {
  const criticalCount = comments.filter((c) => c.severity === 'critical').length;
  const importantCount = comments.filter((c) => c.severity === 'important').length;
  const minorCount = comments.filter((c) => c.severity === 'minor').length;

  return {
    total: comments.length,
    hasCritical: criticalCount > 0,
    criticalCount,
    importantCount,
    minorCount,
  };
}
