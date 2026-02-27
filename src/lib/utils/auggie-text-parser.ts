/**
 * Auggie Text Output Parser
 *
 * Parses Auggie's text mode output to extract:
 * - Assistant responses with markdown
 * - Tool calls and their results
 * - Session information
 * - Error messages
 */



export interface ParsedContent {
  type: 'text' | 'tool_use' | 'tool_result' | 'session_info' | 'error' | 'digest';
  content: string;
  metadata?: {
    toolName?: string | null;
    toolId?: string | null;
    toolInput?: Record<string, any>;
    isError?: boolean;
    sessionId?: string;
  };
}

// Tool call patterns in Auggie's text output
const TOOL_PATTERNS = {
  // Tool start: 🔧 Tool call: tool-name or 🔧 tool-name (with optional ANSI codes)
  toolStart: /(?:\x1B\[\d+m)?🔧\s+(?:Tool call:\s+)?(.+?)(?:\x1B\[0m)?$/,
  // Tool with details: └─ or ├─ description OR indented parameters (3+ spaces)
  toolDetail: /(?:[└├]─\s+(.+)$|^\s{3,}(.+)$)/,
  // Tool result: 📋 Tool result: tool-name (with optional ANSI codes)
  toolResult: /(?:\x1B\[\d+m)?📋\s+Tool result:\s+(.+?)(?:\x1B\[0m)?$/,
  // Tool result success: ✓ or ✔ or ✅ message
  toolSuccess: /[✓✔✅]\s+(.+)$/,
  // Tool result error: ❌ or ✗ or ❎ message
  toolError: /[❌✗❎]\s+(.+)$/,
  // Session info: Session: <id> (case insensitive)
  sessionInfo: /[Ss]ession:\s*([a-f0-9-]+)/,
  // Resumed session: 📂 Resumed session from...
  resumedSession: /📂?\s*Resumed session/i,
  // Assistant marker: 🤖
  assistantMarker: /🤖/,
  // System marker: 💻
  systemMarker: /💻/,
  // User marker: 👤
  userMarker: /👤/,
  // Thinking marker: 🤔 Thinking...
  thinkingMarker: /🤔\s*Thinking/i,
  // Waiting marker: ⏳ Running tool...
  waitingMarker: /^⏳\s+Running/i,
  // Indexing progress: Indexing: [████░░░] 40%
  indexingProgress: /^Indexing:\s*\[.*\]\s*\d+%/,
  // Agent digest: <agent_digest>content</agent_digest> - short summary/question for task status
  agentDigest: /<agent_digest>([\s\S]*?)<\/agent_digest>/,
  // Setup script: <setup_script name="..." description="...">script content</setup_script>
  setupScript: /<setup_script\s+name="([^"]+)"\s+description="([^"]+)">([\s\S]*?)<\/setup_script>/,
};

export class AuggieTextParser {
  private buffer: string = '';
  private currentToolName: string | null = null;
  private currentToolId: string | null = null;
  private lastToolId: string | null = null; // Keep track of last tool ID for result association
  private currentToolParams: string[] = []; // Accumulate tool parameters
  private currentToolResultContent: string[] = []; // Accumulate tool result content
  private inToolResult: boolean = false; // Track if we're in tool result mode
  private inCodeBlock: boolean = false;
  private codeBlockLanguage: string = '';
  private codeBlockContent: string = '';
  private characterBuffer: string = ''; // Buffer for accumulating streaming chunks
  private inCharacterMode: boolean = false; // Track if we're in streaming mode
  private emittedToolIds: Set<string> = new Set(); // Track which tool_use blocks have been emitted

  /**
   * Parse a chunk of text from Auggie's output
   */
  parseChunk(chunk: string): ParsedContent[] {
    // In streaming mode, Auggie sends:
    // 1. Marker (🤖\n)
    // 2. Empty line (\n)
    // 3. Word/phrase fragments without newlines
    // 4. Final newline when done

    // Check if this chunk contains a marker
    if (this.isMarkerLine(chunk.trim())) {
      const results: ParsedContent[] = [];

      // If we're in tool result mode, flush the accumulated content first
      if (this.inToolResult && this.currentToolResultContent.length > 0) {
        const isError = this.currentToolResultContent.some(
          (line) => line.startsWith('❌') || line.startsWith('Error:'),
        );
        const content = this.currentToolResultContent
          .map((line) => line.replace(/^❌\s*/, '').replace(/^Error:\s*/, ''))
          .join('\n');

        results.push({
          type: 'tool_result',
          content,
          metadata: {
            toolId: this.currentToolId,
            isError,
          },
        });

        // Reset tool result state but keep last tool ID
        this.lastToolId = this.currentToolId; // Preserve for potential future results
        this.currentToolId = null;
        this.inToolResult = false;
        this.currentToolResultContent = [];
      }

      // Check if there's content after the marker in the same chunk
      const markerIndex = chunk.indexOf('🤖');
      const afterMarker = chunk.substring(markerIndex + 2); // Skip marker and newline

      this.inCharacterMode = true;
      this.characterBuffer = '';

      // If there's content after the marker, start accumulating it
      if (afterMarker && afterMarker.trim() && afterMarker !== '\n') {
        const contentAfterMarker = afterMarker.replace(/^\n/, ''); // Remove leading newline if present
        if (contentAfterMarker) {
          this.characterBuffer = contentAfterMarker;
        }
      }

      // Return any flushed tool results
      return results;
    }

    // If we're in streaming mode
    if (this.inCharacterMode) {
      // Check if this is just whitespace/newlines after the marker
      if (chunk.trim() === '' && this.characterBuffer === '') {
        // Skip empty lines right after the marker
        return [];
      }

      // If chunk contains newline and we have accumulated content, streaming is done
      if (chunk.includes('\n') && this.characterBuffer.length > 0) {
        // Check if there's any content before the newline
        const beforeNewline = chunk.substring(0, chunk.indexOf('\n'));
        if (beforeNewline) {
          this.characterBuffer += beforeNewline;
        }

        const results: ParsedContent[] = [];

        // Output the accumulated message
        if (this.characterBuffer.trim()) {
          results.push({
            type: 'text',
            content: this.characterBuffer.trim(),
          });
        }

        // Reset state
        this.characterBuffer = '';
        this.inCharacterMode = false;
        this.buffer = ''; // Clear any remaining buffer

        return results;
      }

      // Otherwise, accumulate the chunk
      this.characterBuffer += chunk;
      return [];
    }

    // Check if this chunk contains tool parameters (multiple lines in one chunk)
    if (this.currentToolName && chunk.includes('   ') && chunk.includes('\n')) {
      // This is a multi-line parameter chunk
      const paramLines = chunk.split('\n').filter((l) => l.trim());
      for (const paramLine of paramLines) {
        if (paramLine.startsWith('   ')) {
          this.currentToolParams.push(paramLine.trim());
        }
      }
      // Don't output anything yet
      return [];
    }

    // Check if we're in tool result mode and this is a multi-line result chunk
    if (this.inToolResult && chunk.includes('\n') && !chunk.startsWith('🤖')) {
      // This is the tool result content - output it immediately
      const isError = chunk.includes('❌') || chunk.includes('Error:');
      const content = chunk
        .split('\n')
        .filter((l) => l.trim())
        .map((line) => line.replace(/^❌\s*/, '').replace(/^Error:\s*/, ''))
        .join('\n');

      const result: ParsedContent = {
        type: 'tool_result',
        content,
        metadata: {
          toolId: this.currentToolId,
          isError,
        },
      };

      // Reset tool result state but keep last tool ID
      this.lastToolId = this.currentToolId; // Preserve for potential future results
      this.currentToolId = null;
      this.inToolResult = false;
      this.currentToolResultContent = [];

      return [result];
    }

    // Normal processing for non-streaming content
    this.buffer += chunk;
    const results: ParsedContent[] = [];
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;

      const parsed = this.parseLine(line);
      if (parsed) {
        results.push(parsed);
      }
    }

    return results;
  }

  /**
   * Check if a line is a continuation of a multi-line string parameter
   */
  private isMultilineStringContinuation(line: string): boolean {
    if (this.currentToolParams.length === 0) {
      return false;
    }

    // Check if the last parameter has an unclosed quote
    const lastParam = this.currentToolParams[this.currentToolParams.length - 1];

    // Count quotes in the last parameter
    const quoteCount = (lastParam.match(/"/g) || []).length;

    // If odd number of quotes, we have an unclosed string
    if (quoteCount % 2 === 1) {
      return true;
    }

    // Check if the accumulated params so far form an incomplete JSON object
    const accumulated = this.currentToolParams.join('\n');
    if (accumulated.includes('"content"') || accumulated.includes('content:')) {
      // Check if we have a content field that starts with a quote but doesn't close
      const contentMatch = accumulated.match(/content:\s*"[^"]*$/);
      if (contentMatch) {
        return true;
      }
    }

    return false;
  }

  /**
   * Parse tool parameters from accumulated lines
   */
  private parseToolParams(params: string[]): Record<string, any> {
    if (params.length === 0) {
      return {};
    }

    // Join all parameter lines
    const fullParamString = params.join('\n').trim();

    // First, try to parse as JSON
    if (fullParamString.startsWith('{') || fullParamString.startsWith('[')) {
      try {
        const parsed = JSON.parse(fullParamString);
        return parsed;
      } catch (e) {
        // Not valid JSON, continue with fallback parsing
      }
    }

    // Check if this looks like a JSON object spread across multiple lines
    // This handles cases where the JSON is formatted with each property on its own line
    const looksLikeJSON =
      params.some((p) => p.includes('"') && p.includes(':')) ||
      params.some((p) => p.trim() === '{' || p.trim() === '}');

    if (looksLikeJSON) {
      try {
        // Try to reconstruct and parse as JSON
        const reconstructed = params.join(' ').replace(/\s+/g, ' ').trim();
        const parsed = JSON.parse(reconstructed);
        return parsed;
      } catch (e) {
        // Still not valid JSON, continue with fallback
      }
    }

    // Special handling for workspace/note tools that might have multi-line content
    // Check if this looks like a tool with a content field that spans multiple lines
    const hasContentField = params.some((p) => p.startsWith('content:') || p.includes('"content"'));
    if (hasContentField) {
      const result: Record<string, any> = {};
      let currentKey: string | null = null;
      let currentValue: string[] = [];
      let inMultilineContent = false;

      for (const param of params) {
        // Check if this line starts a new key-value pair
        // Valid keys should be alphanumeric with underscores, not starting with special chars like **
        const keyMatch = param.match(/^"?([a-zA-Z_][a-zA-Z0-9_]*)"?\s*:\s*(.*)$/);

        if (keyMatch && !inMultilineContent) {
          // Save previous key-value pair if exists
          if (currentKey) {
            let value = currentValue.join('\n').trim();
            // Remove surrounding quotes if present
            if (value.startsWith('"') && value.endsWith('"')) {
              value = value.slice(1, -1);
            }
            result[currentKey] = value;
          }

          // Start new key-value pair
          currentKey = keyMatch[1].replace(/"/g, '');
          currentValue = [keyMatch[2]];

          // Check if this is the content field and the value starts with a quote but doesn't end with one
          if (
            currentKey === 'content' &&
            keyMatch[2].startsWith('"') &&
            !keyMatch[2].endsWith('"')
          ) {
            inMultilineContent = true;
          }
        } else if (currentKey) {
          // This is a continuation of the previous value
          currentValue.push(param);

          // Check if this line ends the multi-line content
          if (inMultilineContent && param.endsWith('"')) {
            inMultilineContent = false;
          }
        }
      }

      // Save the last key-value pair
      if (currentKey) {
        let value = currentValue.join('\n').trim();
        // Remove surrounding quotes if present
        if (value.startsWith('"') && value.endsWith('"')) {
          value = value.slice(1, -1);
        } else if (value.startsWith('"')) {
          // Handle case where content starts with a quote but doesn't end with one
          // This happens when the content is multi-line and the closing quote is missing
          value = value.slice(1);
        }
        result[currentKey] = value;
      }

      return result;
    }

    // Fallback to simple key: value parsing
    const result: Record<string, any> = {};

    for (const param of params) {
      // Try to parse as key: value
      const colonIndex = param.indexOf(':');
      if (colonIndex > 0) {
        const key = param.substring(0, colonIndex).trim();
        let value = param.substring(colonIndex + 1).trim();

        // Remove quotes if present
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1);
        }

        result[key] = value;
      }
    }

    return result;
  }

  /**
   * Check if a line is a streaming fragment (part of character-by-character output)
   */
  private isStreamingFragment(line: string): boolean {
    const trimmed = line.trim();
    // Streaming fragments are typically:
    // - Very short (less than 10 chars)
    // - Single words or partial words
    // - Punctuation
    // - Not complete sentences with multiple words and punctuation
    return (
      trimmed.length < 10 &&
      !this.isMarkerLine(line) &&
      !TOOL_PATTERNS.toolDetail.test(line) &&
      !TOOL_PATTERNS.toolSuccess.test(line) &&
      !TOOL_PATTERNS.toolError.test(line) &&
      // Not a complete sentence structure
      !(trimmed.split(/\s+/).length > 3)
    );
  }

  /**
   * Check if a line is a marker line (🤖, 🔧, etc.)
   */
  private isMarkerLine(line: string): boolean {
    const trimmed = line.trim();
    return (
      trimmed === '🤖' ||
      trimmed === '🔧' ||
      trimmed === '💻' ||
      trimmed === '👤' ||
      trimmed === '🤔' ||
      trimmed === '⏳' ||
      TOOL_PATTERNS.assistantMarker.test(line) ||
      TOOL_PATTERNS.systemMarker.test(line) ||
      TOOL_PATTERNS.userMarker.test(line)
    );
  }

  /**
   * Parse a single line of output
   */
  private parseLine(line: string): ParsedContent | null {
    // Skip empty lines unless in code block
    if (!line.trim() && !this.inCodeBlock) {
      return null;
    }

    // IMPORTANT: Skip streaming fragments that aren't special markers
    // These are part of character-by-character streaming and should be ignored
    if (this.isStreamingFragment(line) && !this.isMarkerLine(line)) {
      return null;
    }

    // Clean ANSI codes from the line for pattern matching and display
    const cleanLine = line.replace(/\x1B\[\d+m/g, '').replace(/\x1B\[0m/g, '');

    // Check for code block markers
    if (cleanLine.startsWith('```')) {
      if (!this.inCodeBlock) {
        // Starting code block
        this.inCodeBlock = true;
        this.codeBlockLanguage = line.slice(3).trim();
        this.codeBlockContent = '';
        return null;
      } else {
        // Ending code block
        this.inCodeBlock = false;
        const content = `\`\`\`${this.codeBlockLanguage}\n${this.codeBlockContent}\n\`\`\``;
        this.codeBlockContent = '';
        this.codeBlockLanguage = '';
        return {
          type: 'text',
          content,
        };
      }
    }

    // If in code block, accumulate content
    if (this.inCodeBlock) {
      this.codeBlockContent += (this.codeBlockContent ? '\n' : '') + line;
      return null;
    }

    // Check for session info
    const sessionMatch = cleanLine.match(TOOL_PATTERNS.sessionInfo);
    if (sessionMatch) {
      return {
        type: 'session_info',
        content: cleanLine,
        metadata: {
          sessionId: sessionMatch[1],
        },
      };
    }

    // Check for resumed session
    if (TOOL_PATTERNS.resumedSession.test(cleanLine)) {
      return {
        type: 'session_info',
        content: cleanLine,
      };
    }

    // Check for agent digest: <agent_digest>content</agent_digest>
    // This is a short summary or question from the agent for display in task status
    const digestMatch = cleanLine.match(TOOL_PATTERNS.agentDigest);
    if (digestMatch) {
      const digestContent = digestMatch[1].trim();
      if (digestContent) {
        return {
          type: 'digest',
          content: digestContent,
        };
      }
      // If the tag is present but empty, skip it
      return null;
    }

    // Check for tool start
    const toolStartMatch = cleanLine.match(TOOL_PATTERNS.toolStart);
    if (toolStartMatch) {
      // Extract tool name, removing "Tool call:" prefix if present
      let toolName = toolStartMatch[1];
      if (toolName.startsWith('Tool call:')) {
        toolName = toolName.replace('Tool call:', '').trim();
      }
      // Remove any remaining ANSI codes
      toolName = toolName.replace(/\x1B\[\d+m/g, '').replace(/\x1B\[0m/g, '');

      this.currentToolName = toolName;
      this.currentToolId = `tool-${Date.now()}`;
      this.lastToolId = this.currentToolId; // Keep track of this tool ID
      this.currentToolParams = []; // Reset parameters for new tool
      // Don't return anything yet - accumulate parameters first
      return null;
    }

    // Check for tool result
    const toolResultMatch = cleanLine.match(TOOL_PATTERNS.toolResult);
    if (toolResultMatch) {
      // If we have a pending tool, create the tool_use block (only if not already emitted)
      if (this.currentToolName && this.currentToolId) {
        const results: ParsedContent[] = [];

        // Only emit tool_use if we haven't already
        if (!this.emittedToolIds.has(this.currentToolId)) {
          // Create the tool use block
          const toolUseBlock: ParsedContent = {
            type: 'tool_use',
            content: this.currentToolName,
            metadata: {
              toolName: this.currentToolName,
              toolId: this.currentToolId,
              toolInput: this.parseToolParams(this.currentToolParams),
            },
          };
          results.push(toolUseBlock);
          this.emittedToolIds.add(this.currentToolId);
        }

        // Reset tool tracking but keep ID for result association
        const savedId = this.currentToolId;
        this.currentToolName = null;
        this.currentToolId = savedId; // Keep for result
        this.currentToolParams = [];
        this.inToolResult = true; // Enter tool result mode
        this.currentToolResultContent = []; // Clear result content

        // Return the tool_use block if we created one, otherwise return empty
        return results.length > 0 ? results[0] : null;
      }

      // If we don't have a pending tool, use the last tool ID for association
      this.currentToolId = this.lastToolId; // Use the last tool ID for result association
      this.inToolResult = true;
      this.currentToolResultContent = [];
      return null;
    }

    // Check if we're accumulating tool result content
    if (this.inToolResult) {
      // Check if this line starts a new section (like a new marker or tool)
      const isNewToolStart = cleanLine.match(TOOL_PATTERNS.toolStart);
      const isNewToolResult = cleanLine.match(TOOL_PATTERNS.toolResult);

      if (this.isMarkerLine(cleanLine) || isNewToolStart || isNewToolResult) {
        // Output the accumulated tool result
        if (this.currentToolResultContent.length > 0 || this.inToolResult) {
          const isError = this.currentToolResultContent.some(
            (line) => line.startsWith('❌') || line.startsWith('Error:'),
          );
          const content = this.currentToolResultContent
            .map((line) => line.replace(/^❌\s*/, '').replace(/^Error:\s*/, ''))
            .join('\n');

          const result: ParsedContent = {
            type: 'tool_result',
            content,
            metadata: {
              toolId: this.currentToolId,
              isError,
            },
          };

          // Reset tool result state but keep last tool ID
          this.lastToolId = this.currentToolId; // Preserve for potential future results
          this.currentToolId = null;
          this.inToolResult = false;
          this.currentToolResultContent = [];

          // If this is a new tool start, process it immediately after returning the result
          if (isNewToolStart) {
            // Extract tool name
            let toolName = isNewToolStart[1];
            if (toolName.startsWith('Tool call:')) {
              toolName = toolName.replace('Tool call:', '').trim();
            }
            // Remove any remaining ANSI codes
            toolName = toolName.replace(/\x1B\[\d+m/g, '').replace(/\x1B\[0m/g, '');

            this.currentToolName = toolName;
            this.currentToolId = `tool-${Date.now()}`;
            this.lastToolId = this.currentToolId;
            this.currentToolParams = [];
          } else if (isNewToolResult) {
            // If it's a new tool result, set up for it
            this.currentToolId = this.lastToolId;
            this.inToolResult = true;
            this.currentToolResultContent = [];
          }

          return result;
        }

        // Reset and continue
        this.inToolResult = false;
        this.currentToolResultContent = [];
        this.lastToolId = this.currentToolId; // Preserve for potential future results
        this.currentToolId = null;
      } else {
        // Accumulate tool result content
        this.currentToolResultContent.push(cleanLine);
        return null; // Don't output yet
      }
    }

    // Check for tool detail/parameters (indented lines after tool start)
    // Also check if we're in the middle of a multi-line string parameter
    if (this.currentToolName) {
      const isIndented = line.startsWith('   ');
      const isMultilineContinuation = this.isMultilineStringContinuation(line);

      if (isIndented || isMultilineContinuation) {
        // Accumulate tool parameter
        const paramLine = isIndented ? line.trim() : line; // Keep original formatting for continuations
        this.currentToolParams.push(paramLine);
        // Don't return anything yet - keep accumulating
        return null;
      }
    }

    // Check for tool success
    const successMatch = line.match(TOOL_PATTERNS.toolSuccess);
    if (successMatch) {
      const result = {
        type: 'tool_result' as const,
        content: successMatch[1],
        metadata: {
          toolName: this.currentToolName,
          toolId: this.currentToolId,
          isError: false,
        },
      };
      this.currentToolName = null;
      this.lastToolId = this.currentToolId; // Keep for result association
      this.currentToolId = null;
      return result;
    }

    // Check for tool error
    const errorMatch = line.match(TOOL_PATTERNS.toolError);
    if (errorMatch) {
      const result = {
        type: 'tool_result' as const,
        content: errorMatch[1],
        metadata: {
          toolName: this.currentToolName,
          toolId: this.currentToolId,
          isError: true,
        },
      };
      this.currentToolName = null;
      this.lastToolId = this.currentToolId; // Keep for result association
      this.currentToolId = null;
      return result;
    }

    // Skip system markers and progress indicators
    if (
      TOOL_PATTERNS.assistantMarker.test(line) ||
      TOOL_PATTERNS.systemMarker.test(line) ||
      TOOL_PATTERNS.userMarker.test(line) ||
      TOOL_PATTERNS.thinkingMarker.test(line) ||
      TOOL_PATTERNS.waitingMarker.test(line) ||
      TOOL_PATTERNS.indexingProgress.test(line)
    ) {
      return null;
    }

    // If we have a pending tool and encounter non-tool content, output the tool first
    if (this.currentToolName && this.currentToolId && !line.startsWith('   ')) {
      // Only emit tool_use if we haven't already
      if (!this.emittedToolIds.has(this.currentToolId)) {
        // Output the tool use block
        const toolBlock: ParsedContent = {
          type: 'tool_use',
          content: this.currentToolName,
          metadata: {
            toolName: this.currentToolName,
            toolId: this.currentToolId,
            toolInput: this.parseToolParams(this.currentToolParams),
          },
        };

        // Mark as emitted
        this.emittedToolIds.add(this.currentToolId);

        // Reset tool tracking but preserve the ID for potential result association
        this.currentToolName = null;
        this.lastToolId = this.currentToolId; // Keep for result association
        this.currentToolId = null;
        this.currentToolParams = [];

        // Return the tool block
        // Note: Any text on the same line will be processed on the next call
        return toolBlock;
      }

      // If already emitted, just reset and continue
      this.currentToolName = null;
      this.currentToolParams = [];
    }

    // Everything else is text content (use cleaned line to remove ANSI codes)
    return {
      type: 'text',
      content: cleanLine,
    };
  }

  /**
   * Flush any remaining buffer content
   */
  flush(): ParsedContent[] {
    const results: ParsedContent[] = [];

    // Flush any remaining tool result content
    if (this.inToolResult && this.currentToolResultContent.length > 0) {
      const isError = this.currentToolResultContent.some(
        (line) => line.startsWith('❌') || line.startsWith('Error:'),
      );
      const content = this.currentToolResultContent
        .map((line) => line.replace(/^❌\s*/, '').replace(/^Error:\s*/, ''))
        .join('\n');

      results.push({
        type: 'tool_result',
        content,
        metadata: {
          toolId: this.currentToolId,
          isError,
        },
      });
    }

    // Flush any remaining character buffer content from streaming
    if (this.characterBuffer.trim()) {
      results.push({
        type: 'text',
        content: this.characterBuffer.trim(),
      });
    }
    this.characterBuffer = '';
    this.inCharacterMode = false;

    if (this.buffer.trim()) {
      const parsed = this.parseLine(this.buffer);
      if (parsed) {
        results.push(parsed);
      }
    }

    // If we're still in a code block, close it
    if (this.inCodeBlock && this.codeBlockContent) {
      results.push({
        type: 'text',
        content: `\`\`\`${this.codeBlockLanguage}\n${this.codeBlockContent}\n\`\`\``,
      });
    }

    this.buffer = '';
    this.inCodeBlock = false;
    this.codeBlockContent = '';
    this.codeBlockLanguage = '';
    this.currentToolName = null;
    this.currentToolId = null;
    this.lastToolId = null; // Reset last tool ID
    this.inToolResult = false;
    this.currentToolResultContent = [];
    this.emittedToolIds.clear(); // Clear emitted tool IDs for next message

    return results;
  }

  /**
   * Extract digest from text content
   * Returns the digest text if found, null otherwise
   * Note: This removes the digest tags from the text if found
   */
  static extractDigest(text: string): { digest: string | null; cleanedText: string } {
    const match = text.match(TOOL_PATTERNS.agentDigest);
    if (match) {
      const digest = match[1].trim();
      // Remove the digest tag from the text
      const cleanedText = text.replace(TOOL_PATTERNS.agentDigest, '').trim();
      return { digest: digest || null, cleanedText };
    }
    return { digest: null, cleanedText: text };
  }

  /**
   * Strip agent_digest tags from text for display purposes.
   * Removes complete tags, partial opening tags at end of buffer,
   * and unclosed tags (opening without matching close).
   * This is a safety net for rendering paths.
   */
  static stripDigestTagsForDisplay(text: string): string {
    if (!text) return text;

    // Remove complete <agent_digest>...</agent_digest> tags
    let result = text.replace(/<agent_digest>[\s\S]*?<\/agent_digest>/g, '');

    // Remove unclosed <agent_digest> at end (opening tag present but no closing tag after it)
    const lastOpenIdx = result.lastIndexOf('<agent_digest>');
    if (lastOpenIdx >= 0) {
      const lastCloseIdx = result.lastIndexOf('</agent_digest>');
      if (lastCloseIdx < lastOpenIdx) {
        // Opening tag without matching close — strip from opening tag to end
        result = result.substring(0, lastOpenIdx);
      }
    }

    // Remove partial tag at very end of buffer (tag being built char by char)
    // Check if buffer ends with a '<' followed by a prefix of 'agent_digest>' or '/agent_digest>'
    const lastLT = result.lastIndexOf('<');
    if (lastLT >= 0 && lastLT >= result.length - 20) {
      const tail = result.substring(lastLT);
      if ('<agent_digest>'.startsWith(tail) || '</agent_digest>'.startsWith(tail)) {
        result = result.substring(0, lastLT);
      }
    }

    return result;
  }

  /**
   * Extract setup script from text content
   * Returns the script details if found, null otherwise
   */
  static extractSetupScript(text: string): {
    name: string;
    description: string;
    content: string;
  } | null {
    const match = text.match(TOOL_PATTERNS.setupScript);
    if (match) {
      return {
        name: match[1].trim(),
        description: match[2].trim(),
        content: match[3].trim(),
      };
    }
    return null;
  }

}
