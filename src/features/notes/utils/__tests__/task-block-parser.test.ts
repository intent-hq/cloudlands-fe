import { describe, it, expect } from 'vitest';
import {
  parseTaskBlockContent,
  extractTasksBlocks,
  hasTaskBlocks,
  hasTasksBlocks,
} from '../task-block-parser';

describe('task-block-parser', () => {
  describe('parseTaskBlockContent', () => {
    it('should parse a task with title and content', () => {
      const content = `# Authentication System
Build JWT-based auth for the API layer.

## Requirements
- Login/logout endpoints
- Session management`;

      const task = parseTaskBlockContent(content);

      expect(task).not.toBeNull();
      expect(task!.title).toBe('Authentication System');
      expect(task!.content).toContain('Build JWT-based auth');
      expect(task!.content).toContain('## Requirements');
      expect(task!.content).toContain('- Login/logout endpoints');
    });

    it('should use only the first h1 as title (multiple h1s means only first is title)', () => {
      const content = `# Task One
Content for task one.

# This is part of the body now
More content here.`;

      const task = parseTaskBlockContent(content);

      expect(task).not.toBeNull();
      expect(task!.title).toBe('Task One');
      // The second h1 is now part of the body
      expect(task!.content).toContain('Content for task one.');
      expect(task!.content).toContain('# This is part of the body now');
      expect(task!.content).toContain('More content here.');
    });

    it('should handle task with no body content', () => {
      const content = '# Task With No Content';

      const task = parseTaskBlockContent(content);

      expect(task).not.toBeNull();
      expect(task!.title).toBe('Task With No Content');
      expect(task!.content).toBe('');
    });

    it('should ignore content before the first h1', () => {
      const content = `Some intro text that should be ignored.

# First Task
Task content here.`;

      const task = parseTaskBlockContent(content);

      expect(task).not.toBeNull();
      expect(task!.title).toBe('First Task');
      expect(task!.content).toBe('Task content here.');
    });

    it('should return null for empty content', () => {
      const task = parseTaskBlockContent('');
      expect(task).toBeNull();
    });

    it('should return null for content with no h1 headings', () => {
      const content = `Just some text
## Not an h1
More text`;

      const task = parseTaskBlockContent(content);
      expect(task).toBeNull();
    });

    it('should return null for title that is only whitespace', () => {
      const content = `#
Some body content`;

      const task = parseTaskBlockContent(content);
      expect(task).toBeNull();
    });

    it('should handle Windows line endings (CRLF)', () => {
      const content = '# Task Title\r\nBody line 1\r\nBody line 2';

      const task = parseTaskBlockContent(content);

      expect(task).not.toBeNull();
      expect(task!.title).toBe('Task Title');
      expect(task!.content).toBe('Body line 1\nBody line 2');
    });

    it('should not treat ## or ### as title headings', () => {
      const content = `## This is h2
### This is h3
# This is the real title
Body content`;

      const task = parseTaskBlockContent(content);

      expect(task).not.toBeNull();
      expect(task!.title).toBe('This is the real title');
      expect(task!.content).toBe('Body content');
    });
  });

  describe('extractTasksBlocks', () => {
    it('should extract task from a single task block', () => {
      const content = `# Spec

Some intro text.

\`\`\`task
# Authentication
Build auth system.

## Requirements
- Login endpoint
- Logout endpoint
\`\`\`

More content after.`;

      const result = extractTasksBlocks(content);

      expect(result.blockCount).toBe(1);
      expect(result.validTaskCount).toBe(1);
      expect(result.invalidBlockCount).toBe(0);
      expect(result.tasks).toHaveLength(1);
      expect(result.tasks[0].title).toBe('Authentication');
      expect(result.tasks[0].content).toContain('Build auth system.');
      expect(result.contentWithoutBlocks).toContain('# Spec');
      expect(result.contentWithoutBlocks).toContain('<!-- task-block-placeholder-0 -->');
      expect(result.contentWithoutBlocks).toContain('More content after.');
      expect(result.contentWithoutBlocks).not.toContain('```task');
    });

    it('should extract tasks from multiple task blocks with indexed placeholders', () => {
      const content = `\`\`\`task
# Task A
Content A.
\`\`\`

Some middle content.

\`\`\`task
# Task B
Content B.
\`\`\``;

      const result = extractTasksBlocks(content);

      expect(result.blockCount).toBe(2);
      expect(result.validTaskCount).toBe(2);
      expect(result.tasks).toHaveLength(2);
      expect(result.tasks[0].title).toBe('Task A');
      expect(result.tasks[1].title).toBe('Task B');
      // Check indexed placeholders
      expect(result.contentWithoutBlocks).toContain('<!-- task-block-placeholder-0 -->');
      expect(result.contentWithoutBlocks).toContain('<!-- task-block-placeholder-1 -->');
      expect(result.contentWithoutBlocks).toContain('Some middle content.');
    });

    it('should return empty tasks for content without task blocks', () => {
      const content = `# Regular Markdown
No task blocks here.`;

      const result = extractTasksBlocks(content);

      expect(result.blockCount).toBe(0);
      expect(result.validTaskCount).toBe(0);
      expect(result.tasks).toHaveLength(0);
      expect(result.contentWithoutBlocks).toBe(content);
    });

    it('should mark invalid task blocks and track count', () => {
      const content = `\`\`\`task
Just content without a title heading.
\`\`\``;

      const result = extractTasksBlocks(content);

      expect(result.blockCount).toBe(1);
      expect(result.validTaskCount).toBe(0);
      expect(result.invalidBlockCount).toBe(1);
      expect(result.tasks).toHaveLength(0);
      expect(result.contentWithoutBlocks).toContain('<!-- invalid-task-block-removed -->');
    });

    it('should handle trailing whitespace after task keyword', () => {
      const content = `\`\`\`task
# Task With Trailing Space
Content here.
\`\`\``;

      const result = extractTasksBlocks(content);

      expect(result.blockCount).toBe(1);
      expect(result.validTaskCount).toBe(1);
      expect(result.tasks[0].title).toBe('Task With Trailing Space');
    });

    it('should handle Windows line endings in blocks', () => {
      const content = '```task\r\n# Windows Task\r\nBody content.\r\n```';

      const result = extractTasksBlocks(content);

      expect(result.blockCount).toBe(1);
      expect(result.validTaskCount).toBe(1);
      expect(result.tasks[0].title).toBe('Windows Task');
    });

    it('should handle mixed valid and invalid blocks', () => {
      const content = `\`\`\`task
# Valid Task
Content.
\`\`\`

\`\`\`task
No title here - invalid!
\`\`\`

\`\`\`task
# Another Valid Task
More content.
\`\`\``;

      const result = extractTasksBlocks(content);

      expect(result.blockCount).toBe(3);
      expect(result.validTaskCount).toBe(2);
      expect(result.invalidBlockCount).toBe(1);
      expect(result.tasks[0].title).toBe('Valid Task');
      expect(result.tasks[1].title).toBe('Another Valid Task');
      // Indexed placeholders only for valid tasks
      expect(result.contentWithoutBlocks).toContain('<!-- task-block-placeholder-0 -->');
      expect(result.contentWithoutBlocks).toContain('<!-- invalid-task-block-removed -->');
      expect(result.contentWithoutBlocks).toContain('<!-- task-block-placeholder-1 -->');
    });
  });

  describe('hasTaskBlocks', () => {
    it('should return true when content has task blocks', () => {
      expect(hasTaskBlocks('```task\n# Task\n```')).toBe(true);
    });

    it('should return false when content has no task blocks', () => {
      expect(hasTaskBlocks('# Regular content')).toBe(false);
      expect(hasTaskBlocks('```javascript\ncode\n```')).toBe(false);
    });

    it('should match legacy plural form ```tasks', () => {
      // Legacy ```tasks syntax is still supported for backward compatibility
      expect(hasTaskBlocks('```tasks\n# Task\n```')).toBe(true);
    });

    it('should return consistent results on multiple calls (no global regex state issue)', () => {
      const content = '```task\n# Task\n```';
      // Call multiple times to ensure no alternating true/false due to global regex state
      expect(hasTaskBlocks(content)).toBe(true);
      expect(hasTaskBlocks(content)).toBe(true);
      expect(hasTaskBlocks(content)).toBe(true);
      expect(hasTaskBlocks(content)).toBe(true);
    });

    it('should handle trailing whitespace after task keyword', () => {
      expect(hasTaskBlocks('```task   \n# Task\n```')).toBe(true);
      expect(hasTaskBlocks('```task\t\n# Task\n```')).toBe(true);
    });

    it('should handle Windows line endings', () => {
      expect(hasTaskBlocks('```task\r\n# Task\r\n```')).toBe(true);
    });
  });

  describe('hasTasksBlocks (deprecated alias)', () => {
    it('should work the same as hasTaskBlocks', () => {
      expect(hasTasksBlocks('```task\n# Task\n```')).toBe(true);
      expect(hasTasksBlocks('# Regular content')).toBe(false);
    });
  });

  describe('nested code blocks (bug reproduction)', () => {
    it('should handle a task block containing a nested typescript code block', () => {
      const content = `@@@task
# Task With Code Example
Here is some code:

\`\`\`typescript
function hello() {
  console.log('world');
}
\`\`\`

That was the code.
@@@`;

      const result = extractTasksBlocks(content);

      expect(result.blockCount).toBe(1);
      expect(result.validTaskCount).toBe(1);
      expect(result.tasks).toHaveLength(1);
      expect(result.tasks[0].title).toBe('Task With Code Example');
      // The task content should include the nested code block
      expect(result.tasks[0].content).toContain('Here is some code:');
      expect(result.tasks[0].content).toContain('```typescript');
      expect(result.tasks[0].content).toContain("console.log('world');");
      expect(result.tasks[0].content).toContain('That was the code.');
    });

    it('should handle a task block with multiple nested code blocks', () => {
      const content = `@@@task
# Task With Multiple Code Examples
First example:

\`\`\`javascript
const x = 1;
\`\`\`

Second example:

\`\`\`python
def foo():
    pass
\`\`\`

Done.
@@@`;

      const result = extractTasksBlocks(content);

      expect(result.blockCount).toBe(1);
      expect(result.validTaskCount).toBe(1);
      expect(result.tasks).toHaveLength(1);
      expect(result.tasks[0].title).toBe('Task With Multiple Code Examples');
      expect(result.tasks[0].content).toContain('First example:');
      expect(result.tasks[0].content).toContain('```javascript');
      expect(result.tasks[0].content).toContain('const x = 1;');
      expect(result.tasks[0].content).toContain('Second example:');
      expect(result.tasks[0].content).toContain('```python');
      expect(result.tasks[0].content).toContain('def foo():');
      expect(result.tasks[0].content).toContain('Done.');
    });

    it('should capture content after a nested code block', () => {
      const content = `@@@task
# Task With Content After Code
Before code.

\`\`\`bash
echo "hello"
\`\`\`

After code - this is important!
@@@`;

      const result = extractTasksBlocks(content);

      expect(result.blockCount).toBe(1);
      expect(result.validTaskCount).toBe(1);
      expect(result.tasks).toHaveLength(1);
      expect(result.tasks[0].title).toBe('Task With Content After Code');
      expect(result.tasks[0].content).toContain('Before code.');
      expect(result.tasks[0].content).toContain('```bash');
      expect(result.tasks[0].content).toContain('echo "hello"');
      // This is the critical assertion - content after the nested code block
      expect(result.tasks[0].content).toContain('After code - this is important!');
    });

    it('should handle two adjacent task blocks, each containing nested code', () => {
      const content = `@@@task
# First Task With Code
Implementation:

\`\`\`typescript
interface User {
  id: string;
}
\`\`\`
@@@

@@@task
# Second Task With Code
Usage:

\`\`\`typescript
const user: User = { id: '123' };
\`\`\`
@@@`;

      const result = extractTasksBlocks(content);

      expect(result.blockCount).toBe(2);
      expect(result.validTaskCount).toBe(2);
      expect(result.tasks).toHaveLength(2);

      // First task
      expect(result.tasks[0].title).toBe('First Task With Code');
      expect(result.tasks[0].content).toContain('Implementation:');
      expect(result.tasks[0].content).toContain('```typescript');
      expect(result.tasks[0].content).toContain('interface User');

      // Second task
      expect(result.tasks[1].title).toBe('Second Task With Code');
      expect(result.tasks[1].content).toContain('Usage:');
      expect(result.tasks[1].content).toContain('```typescript');
      expect(result.tasks[1].content).toContain('const user: User');

      // Both placeholders should be present
      expect(result.contentWithoutBlocks).toContain('<!-- task-block-placeholder-0 -->');
      expect(result.contentWithoutBlocks).toContain('<!-- task-block-placeholder-1 -->');
    });

    it('should handle legacy ```task syntax with nested code blocks', () => {
      // This is the bug case: ```task blocks containing nested code fences
      const content = `\`\`\`task
# Fix Something
Here is the issue.

## Suggested Fix
\`\`\`typescript
// Always use OUR workspace-mcp
merged.mcpServers['workspace-mcp'] = desired.mcpServers['workspace-mcp'];
\`\`\`

That should fix it.
\`\`\``;

      const result = extractTasksBlocks(content);

      expect(result.blockCount).toBe(1);
      expect(result.validTaskCount).toBe(1);
      expect(result.tasks).toHaveLength(1);
      expect(result.tasks[0].title).toBe('Fix Something');
      // The task content should include the nested code block
      expect(result.tasks[0].content).toContain('Here is the issue.');
      expect(result.tasks[0].content).toContain('```typescript');
      expect(result.tasks[0].content).toContain("merged.mcpServers['workspace-mcp']");
      expect(result.tasks[0].content).toContain('That should fix it.');
    });

    it('should handle legacy ```task syntax with multiple nested code blocks', () => {
      const content = `\`\`\`task
# Task With Multiple Code Examples
First example:

\`\`\`javascript
const x = 1;
\`\`\`

Second example:

\`\`\`python
def foo():
    pass
\`\`\`

Done.
\`\`\``;

      const result = extractTasksBlocks(content);

      expect(result.blockCount).toBe(1);
      expect(result.validTaskCount).toBe(1);
      expect(result.tasks).toHaveLength(1);
      expect(result.tasks[0].title).toBe('Task With Multiple Code Examples');
      expect(result.tasks[0].content).toContain('First example:');
      expect(result.tasks[0].content).toContain('```javascript');
      expect(result.tasks[0].content).toContain('const x = 1;');
      expect(result.tasks[0].content).toContain('Second example:');
      expect(result.tasks[0].content).toContain('```python');
      expect(result.tasks[0].content).toContain('def foo():');
      expect(result.tasks[0].content).toContain('Done.');
    });
  });
});
