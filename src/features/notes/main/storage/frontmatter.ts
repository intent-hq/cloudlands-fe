/**
 * Frontmatter Parser/Serializer
 *
 * Handles YAML frontmatter in markdown files.
 * Format:
 * ---
 * id: note-id
 * title: Note Title
 * tags: [tag1, tag2]
 * ---
 *
 * # Content starts here
 */

import type { NoteFrontmatter } from './note-storage.types';
import type { NoteId } from '../../../../shared/types';

const FRONTMATTER_DELIMITER = '---';

/**
 * Parse frontmatter from markdown content
 * Returns frontmatter object and content without frontmatter
 */
export function parseFrontmatter(markdown: string): {
  frontmatter: NoteFrontmatter | null;
  content: string;
} {
  const trimmed = markdown.trim();

  // Check if starts with frontmatter delimiter
  if (!trimmed.startsWith(FRONTMATTER_DELIMITER)) {
    return { frontmatter: null, content: markdown };
  }

  // Find end of frontmatter
  const endIndex = trimmed.indexOf(FRONTMATTER_DELIMITER, 3);
  if (endIndex === -1) {
    return { frontmatter: null, content: markdown };
  }

  const frontmatterStr = trimmed.slice(3, endIndex).trim();
  const content = trimmed.slice(endIndex + 3).trim();

  try {
    const frontmatter = parseYamlSimple(frontmatterStr) as unknown as NoteFrontmatter;
    return { frontmatter, content };
  } catch {
    return { frontmatter: null, content: markdown };
  }
}

/**
 * Serialize frontmatter and content to markdown
 */
export function serializeFrontmatter(frontmatter: NoteFrontmatter, content: string): string {
  const yamlStr = serializeYamlSimple(frontmatter as unknown as Record<string, unknown>);
  return `${FRONTMATTER_DELIMITER}\n${yamlStr}${FRONTMATTER_DELIMITER}\n\n${content}`;
}

/**
 * Get the indentation level of a line (number of leading spaces / 2)
 */
function getIndentLevel(line: string): number {
  const match = line.match(/^(\s*)/);
  return match ? Math.floor(match[1].length / 2) : 0;
}

/**
 * Simple YAML parser (handles our frontmatter subset)
 * Supports: strings, numbers, booleans, arrays, nested objects
 */
function parseYamlSimple(yaml: string): Record<string, unknown> {
  const lines = yaml.split('\n');
  return parseYamlBlock(lines, 0, 0).result;
}

/**
 * Parse a block of YAML at a given indentation level
 */
function parseYamlBlock(
  lines: string[],
  startIndex: number,
  expectedIndent: number,
): { result: Record<string, unknown>; endIndex: number } {
  const result: Record<string, unknown> = {};
  let i = startIndex;

  while (i < lines.length) {
    const line = lines[i];
    const trimmedLine = line.trim();

    // Skip empty lines and comments
    if (!trimmedLine || trimmedLine.startsWith('#')) {
      i++;
      continue;
    }

    const currentIndent = getIndentLevel(line);

    // If we've dedented, we're done with this block
    if (currentIndent < expectedIndent) {
      break;
    }

    // Skip lines that are more indented than expected (handled by nested parsing)
    if (currentIndent > expectedIndent) {
      i++;
      continue;
    }

    const colonIndex = trimmedLine.indexOf(':');
    if (colonIndex === -1) {
      i++;
      continue;
    }

    const key = trimmedLine.slice(0, colonIndex).trim();
    const value: string = trimmedLine.slice(colonIndex + 1).trim();

    // Check if next line is more indented (nested object or block array)
    const nextLineIndex = i + 1;
    const hasNestedContent =
      nextLineIndex < lines.length &&
      lines[nextLineIndex].trim() &&
      getIndentLevel(lines[nextLineIndex]) > currentIndent;

    if (value === '' && hasNestedContent) {
      // Check if it's a block array (next line starts with -)
      const nextTrimmed = lines[nextLineIndex].trim();
      if (nextTrimmed.startsWith('-')) {
        // Parse block array
        const arrayResult = parseYamlBlockArray(lines, nextLineIndex, currentIndent + 1);
        result[key] = arrayResult.result;
        i = arrayResult.endIndex;
      } else {
        // Nested object
        const nestedResult = parseYamlBlock(lines, nextLineIndex, currentIndent + 1);
        result[key] = nestedResult.result;
        i = nestedResult.endIndex;
      }
    } else {
      // Simple value
      result[key] = parseYamlValue(value);
      i++;
    }
  }

  return { result, endIndex: i };
}

/**
 * Parse a block-style YAML array
 */
function parseYamlBlockArray(
  lines: string[],
  startIndex: number,
  expectedIndent: number,
): { result: unknown[]; endIndex: number } {
  const result: unknown[] = [];
  let i = startIndex;

  while (i < lines.length) {
    const line = lines[i];
    const trimmedLine = line.trim();

    if (!trimmedLine || trimmedLine.startsWith('#')) {
      i++;
      continue;
    }

    const currentIndent = getIndentLevel(line);

    if (currentIndent < expectedIndent) {
      break;
    }

    if (currentIndent > expectedIndent) {
      i++;
      continue;
    }

    if (!trimmedLine.startsWith('-')) {
      break;
    }

    // Get the content after the dash
    const itemContent = trimmedLine.slice(1).trim();

    if (itemContent === '') {
      // Check for nested object in array item
      const nextLineIndex = i + 1;
      if (
        nextLineIndex < lines.length &&
        lines[nextLineIndex].trim() &&
        getIndentLevel(lines[nextLineIndex]) > currentIndent
      ) {
        const nestedResult = parseYamlBlock(lines, nextLineIndex, currentIndent + 1);
        result.push(nestedResult.result);
        i = nestedResult.endIndex;
      } else {
        i++;
      }
    } else if (itemContent.includes(':')) {
      // Inline object property on same line as dash (e.g., "- noteId: abc123")
      // Parse this line as first property, then check for more properties on subsequent lines
      const colonIdx = itemContent.indexOf(':');
      const firstKey = itemContent.slice(0, colonIdx).trim();
      const firstValue = itemContent.slice(colonIdx + 1).trim();
      const obj: Record<string, unknown> = {};
      obj[firstKey] = parseYamlValue(firstValue);

      // Check for additional properties on subsequent lines at higher indent
      let nextIdx = i + 1;
      while (nextIdx < lines.length) {
        const nextLine = lines[nextIdx];
        const nextTrimmed = nextLine.trim();
        if (!nextTrimmed || nextTrimmed.startsWith('#')) {
          nextIdx++;
          continue;
        }
        const nextIndent = getIndentLevel(nextLine);
        // Additional properties should be at currentIndent + 1 (same as the first property would be if on its own line)
        if (nextIndent <= currentIndent || nextTrimmed.startsWith('-')) {
          break;
        }
        // Parse as key: value
        const nextColonIdx = nextTrimmed.indexOf(':');
        if (nextColonIdx !== -1) {
          const nextKey = nextTrimmed.slice(0, nextColonIdx).trim();
          const nextValue = nextTrimmed.slice(nextColonIdx + 1).trim();
          obj[nextKey] = parseYamlValue(nextValue);
        }
        nextIdx++;
      }
      result.push(obj);
      i = nextIdx;
    } else {
      result.push(parseYamlValue(itemContent));
      i++;
    }
  }

  return { result, endIndex: i };
}

/**
 * Parse a single YAML value
 */
function parseYamlValue(value: string): unknown {
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'null' || value === '') return undefined;
  if (value.startsWith('"') && value.endsWith('"')) return value.slice(1, -1);
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1);
  // Handle inline arrays
  if (value.startsWith('[') && value.endsWith(']')) {
    const arrayContent = value.slice(1, -1);
    if (arrayContent.trim() === '') return [];
    return arrayContent
      .split(',')
      .map((item: string) => parseYamlValue(item.trim()))
      .filter((item: unknown) => item !== undefined);
  }
  if (!isNaN(Number(value)) && value !== '') return Number(value);
  return value;
}

/**
 * Simple YAML serializer
 */
function serializeYamlSimple(obj: Record<string, unknown>, indent = 0): string {
  const lines: string[] = [];
  const prefix = '  '.repeat(indent);

  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined || value === null) continue;

    if (Array.isArray(value)) {
      if (value.length === 0) continue;
      // Check if array contains objects
      if (value.some((v) => typeof v === 'object' && v !== null && !Array.isArray(v))) {
        // Array of objects - use block style
        lines.push(`${prefix}${key}:`);
        for (const item of value) {
          if (typeof item === 'object' && item !== null) {
            const nestedLines = serializeYamlSimple(item as Record<string, unknown>, indent + 1)
              .trim()
              .split('\n');
            lines.push(`${prefix}  -`);
            for (const nestedLine of nestedLines) {
              lines.push(`${prefix}  ${nestedLine}`);
            }
          } else {
            lines.push(`${prefix}  - ${serializeYamlValue(item)}`);
          }
        }
      } else {
        // Simple array - use inline style
        const items = value.map((v) => serializeYamlValue(v)).join(', ');
        lines.push(`${prefix}${key}: [${items}]`);
      }
    } else if (typeof value === 'object') {
      // Nested object - serialize recursively
      lines.push(`${prefix}${key}:`);
      const nestedLines = serializeYamlSimple(value as Record<string, unknown>, indent + 1);
      lines.push(nestedLines.trimEnd());
    } else {
      lines.push(`${prefix}${key}: ${serializeYamlValue(value)}`);
    }
  }

  return `${lines.join('\n')}\n`;
}

/**
 * Serialize a single value for YAML
 */
function serializeYamlValue(value: unknown): string {
  if (typeof value === 'string') {
    // Quote if contains special chars
    if (value.includes(':') || value.includes('#') || value.includes('\n')) {
      return `"${value.replace(/"/g, '\\"')}"`;
    }
    return value;
  }
  if (typeof value === 'boolean' || typeof value === 'number') {
    return String(value);
  }
  return String(value);
}

/**
 * Create default frontmatter for a new note
 */
export function createDefaultFrontmatter(id: NoteId, title: string): NoteFrontmatter {
  return {
    id,
    title,
    created: new Date().toISOString(),
  };
}
