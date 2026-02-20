import { describe, it, expect } from 'vitest';
import { cleanAgentMessage, parseAgentMessage, parseSuggestedPrompts } from '../messageParser';

describe('cleanAgentMessage', () => {
  it('should remove ANSI escape codes', () => {
    const input = '\u001b[90m🔧 Tool call: view\u001b[0m';
    const result = cleanAgentMessage(input);
    expect(result).not.toContain('\u001b');
  });

  it('should remove logs section', () => {
    const input = 'This is the message\nlogs:\n[debug info]';
    const result = cleanAgentMessage(input);
    expect(result).toBe('This is the message');
    expect(result).not.toContain('logs:');
  });

  it('should normalize excessive newlines', () => {
    const input = 'Line 1\n\n\n\nLine 2';
    const result = cleanAgentMessage(input);
    expect(result).toBe('Line 1\n\nLine 2');
  });

  it('should trim trailing whitespace', () => {
    const input = 'Line 1   \nLine 2  ';
    const result = cleanAgentMessage(input);
    expect(result).toBe('Line 1\nLine 2');
  });

  it('should handle robot emoji marker', () => {
    const input = '🔧 Tool call: view\n🤖\nHere is the actual message';
    const result = cleanAgentMessage(input);
    expect(result).toContain('Here is the actual message');
  });

  it('should preserve markdown formatting', () => {
    const input = '# Heading\n\n**Bold text** and *italic*\n\n- List item 1\n- List item 2';
    const result = cleanAgentMessage(input);
    expect(result).toContain('# Heading');
    expect(result).toContain('**Bold text**');
    expect(result).toContain('- List item 1');
  });

  it('should preserve code blocks', () => {
    const input = '```typescript\nconst x = 1;\n```';
    const result = cleanAgentMessage(input);
    expect(result).toContain('```typescript');
    expect(result).toContain('const x = 1;');
  });

  it('should handle empty input', () => {
    expect(cleanAgentMessage('')).toBe('');
    expect(cleanAgentMessage('   ')).toBe('');
  });

  it('should remove tool call markers before robot emoji', () => {
    const input =
      '🔧 Tool call: launch-process\n   command: ls\n📋 Tool result: launch-process\n✅ Success\n🤖\nActual message here';
    const result = cleanAgentMessage(input);
    expect(result).toContain('Actual message here');
    expect(result).not.toContain('Tool call:');
  });

  it('should handle real-world example', () => {
    const input = `Great! The specification already has dark mode defined. Let me enhance it with more detailed requirements and acceptance criteria. I'll update the SPEC.md file:

Str Replace Editor
-- Description: Support for dark mode theme across the application
-- Requirements:

Toggle between light and dark themes
Persist user's theme preference (local storage or user settings)
Apply dark mode to all UI components
Ensure sufficient contrast ratios for accessibility (WCAG AA standard minimum)
Support system preference detection (prefers-color-scheme)
-- Implementation Considerations:
CSS variables or theme provider pattern for consistent styling
Smooth transitions between themes
Dark mode should not impact performance
-- Acceptance Criteria:
User can toggle dark mode on/off
Theme preference persists across sessions
... 45 more lines

The view tool seems to have issues with this path. Let me use a different approach and write directly to the file:

Excellent! ✅ I've successfully updated the workspace specification with an enhanced dark mode feature. Here's what I added:

## Summary of Dark Mode Specification Updates**:

- Added specific WCAG AA contrast ratios (4.5:1 for normal text, 3:1 for large text)
- Included support for all interactive elements
- Added consistent color palette requirement

logs:
[debug info here]`;

    const result = cleanAgentMessage(input);

    // Should keep the main message
    expect(result).toContain('Great! The specification already has dark mode defined');
    expect(result).toContain("Excellent! ✅ I've successfully updated");

    // Should remove logs
    expect(result).not.toContain('logs:');
    expect(result).not.toContain('[debug info here]');

    // Should not contain tool headers (these should be filtered by AuggieTextParser)
    // but if they leak through, cleanAgentMessage should handle them gracefully
  });
});

describe('parseAgentMessage', () => {
  it('should parse XML-style augment_code_snippet tags', () => {
    const input = `Here is some code:

<augment_code_snippet path="src/store.ts" mode="EXCERPT">
\`\`\`\`typescript
const x = 1;
\`\`\`\`
</augment_code_snippet>

That's the code.`;

    const result = parseAgentMessage(input);

    // Should have 3 blocks: text, augment_code_snippet, text
    expect(result.length).toBe(3);
    expect(result[0].type).toBe('text');
    expect(result[0].content).toContain('Here is some code');
    expect(result[1].type).toBe('augment_code_snippet');
    expect(result[1].content).toBe('const x = 1;');
    expect(result[1].metadata?.path).toBe('src/store.ts');
    expect(result[1].metadata?.mode).toBe('EXCERPT');
    expect(result[1].metadata?.language).toBe('typescript');
    expect(result[2].type).toBe('text');
    expect(result[2].content).toContain("That's the code");
  });

  it('should parse markdown-style code blocks with path= attribute (4 backticks)', () => {
    const input = `Here is some code:

\`\`\`\`typescript path=src/store.ts mode=EXCERPT
const x = 1;
\`\`\`\`

That's the code.`;

    const result = parseAgentMessage(input);

    // Should have 3 blocks: text, augment_code_snippet, text
    expect(result.length).toBe(3);
    expect(result[0].type).toBe('text');
    expect(result[0].content).toContain('Here is some code');
    expect(result[1].type).toBe('augment_code_snippet');
    expect(result[1].content).toBe('const x = 1;');
    expect(result[1].metadata?.path).toBe('src/store.ts');
    expect(result[1].metadata?.mode).toBe('EXCERPT');
    expect(result[1].metadata?.language).toBe('typescript');
    expect(result[2].type).toBe('text');
    expect(result[2].content).toContain("That's the code");
  });

  it('should parse markdown-style code blocks with path= attribute (3 backticks)', () => {
    const input = `Here is some code:

\`\`\`typescript path=src/store.ts mode=EXCERPT
const x = 1;
\`\`\`

That's the code.`;

    const result = parseAgentMessage(input);

    // Should have 3 blocks: text, augment_code_snippet, text
    expect(result.length).toBe(3);
    expect(result[0].type).toBe('text');
    expect(result[0].content).toContain('Here is some code');
    expect(result[1].type).toBe('augment_code_snippet');
    expect(result[1].content).toBe('const x = 1;');
    expect(result[1].metadata?.path).toBe('src/store.ts');
    expect(result[1].metadata?.mode).toBe('EXCERPT');
    expect(result[1].metadata?.language).toBe('typescript');
    expect(result[2].type).toBe('text');
    expect(result[2].content).toContain("That's the code");
  });

  it('should parse markdown-style code blocks without mode', () => {
    const input = `\`\`\`typescript path=src/store.ts
const x = 1;
\`\`\``;

    const result = parseAgentMessage(input);

    expect(result.length).toBe(1);
    expect(result[0].type).toBe('augment_code_snippet');
    expect(result[0].metadata?.path).toBe('src/store.ts');
    expect(result[0].metadata?.mode).toBe('EXCERPT'); // default
    expect(result[0].metadata?.language).toBe('typescript');
  });

  it('should not parse regular code blocks as augment_code_snippet', () => {
    const input = `\`\`\`typescript
const x = 1;
\`\`\``;

    const result = parseAgentMessage(input);

    expect(result.length).toBe(1);
    expect(result[0].type).toBe('code');
    expect(result[0].content).toBe('const x = 1;');
    expect(result[0].metadata?.language).toBe('typescript');
  });

  it('should parse agent_digest tags inline', () => {
    const input = `Here is my work:

I completed the auth module.

<agent_digest>Completed auth module</agent_digest>

Let me know if you have questions.`;

    const result = parseAgentMessage(input);

    // Should have 3 blocks: text, digest, text
    expect(result.length).toBe(3);
    expect(result[0].type).toBe('text');
    expect(result[0].content).toContain('Here is my work');
    expect(result[0].content).toContain('I completed the auth module');
    expect(result[1].type).toBe('digest');
    expect(result[1].content).toBe('Completed auth module');
    expect(result[2].type).toBe('text');
    expect(result[2].content).toContain('Let me know if you have questions');
  });

  it('should handle digest at the end of message', () => {
    const input = `I finished the task successfully.

<agent_digest>Task complete - ready for review</agent_digest>`;

    const result = parseAgentMessage(input);

    expect(result.length).toBe(2);
    expect(result[0].type).toBe('text');
    expect(result[0].content).toContain('I finished the task');
    expect(result[1].type).toBe('digest');
    expect(result[1].content).toBe('Task complete - ready for review');
  });

  it('should handle digest at the start of message', () => {
    const input = `<agent_digest>Starting authentication work</agent_digest>

I'll begin by reviewing the existing code.`;

    const result = parseAgentMessage(input);

    expect(result.length).toBe(2);
    expect(result[0].type).toBe('digest');
    expect(result[0].content).toBe('Starting authentication work');
    expect(result[1].type).toBe('text');
    expect(result[1].content).toContain('reviewing the existing code');
  });

  it('should skip empty digest tags', () => {
    const input = 'Some text <agent_digest></agent_digest> more text';

    const result = parseAgentMessage(input);

    // Empty digest should be skipped - content should be merged as text
    expect(result.length).toBe(1);
    expect(result[0].type).toBe('text');
    expect(result[0].content).toContain('Some text');
    expect(result[0].content).toContain('more text');
  });

  it('should parse ws-block:patch with target format', () => {
    const input = `Here is a patch:

\`\`\`ws-block:patch
{"target":{"filePath":"src/app.ts","diff":"--- a/src/app.ts\\n+++ b/src/app.ts\\n@@ -1,3 +1,4 @@\\n+import { newDep } from 'lib';\\n import React from 'react';","description":"Add new import"}}
\`\`\`

Done.`;

    const result = parseAgentMessage(input);

    expect(result.length).toBe(3);
    expect(result[0].type).toBe('text');
    expect(result[0].content).toContain('Here is a patch');
    expect(result[1].type).toBe('patch');
    expect(result[1].metadata?.patchData?.filePath).toBe('src/app.ts');
    expect(result[1].metadata?.patchData?.diff).toContain('+import { newDep }');
    expect(result[1].metadata?.patchData?.description).toBe('Add new import');
    expect(result[2].type).toBe('text');
    expect(result[2].content).toContain('Done');
  });

  it('should parse ws-block:patch with standard PatchPrimitive format', () => {
    const input = `\`\`\`ws-block:patch
{"type":"patch","patches":[{"filePath":"src/index.ts","diff":"--- a/src/index.ts\\n+++ b/src/index.ts\\n@@ -1 +1,2 @@\\n+console.log('hello');"}],"label":"Add logging"}
\`\`\``;

    const result = parseAgentMessage(input);

    expect(result.length).toBe(1);
    expect(result[0].type).toBe('patch');
    expect(result[0].metadata?.patchData?.filePath).toBe('src/index.ts');
    expect(result[0].metadata?.patchData?.diff).toContain("+console.log('hello')");
    expect(result[0].metadata?.patchData?.description).toBe('Add logging');
  });

  it('should parse ws-block:patch with flat format', () => {
    const input = `\`\`\`ws-block:patch
{"filePath":"src/utils.ts","diff":"--- a/src/utils.ts\\n+++ b/src/utils.ts\\n@@ -1 +1 @@\\n-old\\n+new","description":"Update utils"}
\`\`\``;

    const result = parseAgentMessage(input);

    expect(result.length).toBe(1);
    expect(result[0].type).toBe('patch');
    expect(result[0].metadata?.patchData?.filePath).toBe('src/utils.ts');
    expect(result[0].metadata?.patchData?.diff).toContain('-old');
    expect(result[0].metadata?.patchData?.diff).toContain('+new');
    expect(result[0].metadata?.patchData?.description).toBe('Update utils');
  });

  it('should parse ws-block:patch with literal newlines in diff (agent raw output)', () => {
    // Simulate what the agent actually sends: the diff field contains literal newline
    // characters rather than escaped \\n sequences, which breaks naive JSON.parse()
    const input = '```ws-block:patch\n{"target":{"filePath":"README.md","diff":"--- a/README.md\n+++ b/README.md\n@@ -1,5 +1,7 @@\n # Title\n \n+New line here.\n+\n > Description","description":"Add a line"}}\n```';

    const result = parseAgentMessage(input);

    expect(result.length).toBe(1);
    expect(result[0].type).toBe('patch');
    expect(result[0].metadata?.patchData?.filePath).toBe('README.md');
    expect(result[0].metadata?.patchData?.diff).toContain('+New line here.');
    expect(result[0].metadata?.patchData?.description).toBe('Add a line');
  });

  it('should fallback to text for invalid ws-block:patch JSON', () => {
    const input = `\`\`\`ws-block:patch
not valid json
\`\`\``;

    const result = parseAgentMessage(input);

    expect(result.length).toBe(1);
    expect(result[0].type).toBe('text');
    expect(result[0].content).toContain('ws-block:patch');
  });

  it('should parse ws-block:reference with target format', () => {
    const input = `Here is a reference:

\`\`\`ws-block:reference
{"target":{"kind":"function","semanticId":"src/utils.ts#myFunction","filePath":"src/utils.ts"},"description":"The utility function"}
\`\`\`

Check it out.`;

    const result = parseAgentMessage(input);

    expect(result.length).toBe(3);
    expect(result[0].type).toBe('text');
    expect(result[0].content).toContain('Here is a reference');
    expect(result[1].type).toBe('reference');
    expect(result[1].metadata?.referenceData?.semanticId).toBe('src/utils.ts#myFunction');
    expect(result[1].metadata?.referenceData?.filePath).toBe('src/utils.ts');
    expect(result[1].metadata?.referenceData?.description).toBe('The utility function');
    expect(result[2].type).toBe('text');
    expect(result[2].content).toContain('Check it out');
  });

  it('should parse ws-block:reference with snapshot', () => {
    const input = `\`\`\`ws-block:reference
{"target":{"kind":"function","semanticId":"src/app.ts#init","filePath":"src/app.ts"},"description":"Init function","snapshot":{"code":"function init() { return true; }","filePath":"src/app.ts","languageId":"typescript"}}
\`\`\``;

    const result = parseAgentMessage(input);

    expect(result.length).toBe(1);
    expect(result[0].type).toBe('reference');
    expect(result[0].metadata?.referenceData?.snapshot?.code).toBe('function init() { return true; }');
    expect(result[0].metadata?.referenceData?.snapshot?.languageId).toBe('typescript');
  });

  it('should fallback to text for invalid ws-block:reference JSON', () => {
    const input = `\`\`\`ws-block:reference
not valid json
\`\`\``;

    const result = parseAgentMessage(input);

    expect(result.length).toBe(1);
    expect(result[0].type).toBe('text');
    expect(result[0].content).toContain('ws-block:reference');
  });

  it('should parse ws-block:cli', () => {
    const input = `Run this command:

\`\`\`ws-block:cli
{"command":"npm install","description":"Install dependencies","cwd":"/home/user/project"}
\`\`\`

That should do it.`;

    const result = parseAgentMessage(input);

    expect(result.length).toBe(3);
    expect(result[0].type).toBe('text');
    expect(result[0].content).toContain('Run this command');
    expect(result[1].type).toBe('cli');
    expect(result[1].content).toBe('npm install');
    expect(result[1].metadata?.cliData?.command).toBe('npm install');
    expect(result[1].metadata?.cliData?.description).toBe('Install dependencies');
    expect(result[1].metadata?.cliData?.cwd).toBe('/home/user/project');
    expect(result[2].type).toBe('text');
    expect(result[2].content).toContain('That should do it');
  });

  it('should fallback to text for invalid ws-block:cli JSON', () => {
    const input = `\`\`\`ws-block:cli
not valid json
\`\`\``;

    const result = parseAgentMessage(input);

    expect(result.length).toBe(1);
    expect(result[0].type).toBe('text');
    expect(result[0].content).toContain('ws-block:cli');
  });

  it('should parse ws-block:agent_action', () => {
    const input = `Here's an action:

\`\`\`ws-block:agent_action
{"agentId":"agent-123","goal":"Review the PR and suggest improvements","description":"Code review agent"}
\`\`\`

Let me know when it's done.`;

    const result = parseAgentMessage(input);

    expect(result.length).toBe(3);
    expect(result[0].type).toBe('text');
    expect(result[0].content).toContain("Here's an action");
    expect(result[1].type).toBe('agent_action');
    expect(result[1].content).toBe('Review the PR and suggest improvements');
    expect(result[1].metadata?.agentActionData?.agentId).toBe('agent-123');
    expect(result[1].metadata?.agentActionData?.goal).toBe('Review the PR and suggest improvements');
    expect(result[1].metadata?.agentActionData?.description).toBe('Code review agent');
    expect(result[2].type).toBe('text');
    expect(result[2].content).toContain("Let me know when it's done");
  });

  it('should fallback to text for invalid ws-block:agent_action JSON', () => {
    const input = `\`\`\`ws-block:agent_action
not valid json
\`\`\``;

    const result = parseAgentMessage(input);

    expect(result.length).toBe(1);
    expect(result[0].type).toBe('text');
    expect(result[0].content).toContain('ws-block:agent_action');
  });
});

describe('parseSuggestedPrompts', () => {
  it('should parse plain prompts (backward compatibility)', () => {
    const content = `Some message here.

<!-- suggested-prompts
Run tests
Review code
-->`;

    const result = parseSuggestedPrompts(content);

    expect(result.prompts).toEqual(['Run tests', 'Review code']);
  });

  it('should parse Label|prompt syntax', () => {
    const content = `<!-- suggested-prompts
Label|Full prompt text
-->`;

    const result = parseSuggestedPrompts(content);

    expect(result.prompts).toEqual(['Full prompt text']);
  });

  it('should strip delay:N| prefix and return plain string', () => {
    const content = `<!-- suggested-prompts
delay:60|Check deployment
-->`;

    const result = parseSuggestedPrompts(content);

    expect(result.prompts.length).toBe(1);
    expect(result.prompts[0]).toBe('Check deployment');
  });

  it('should strip Label|delay:N| prefix and return plain string', () => {
    const content = `<!-- suggested-prompts
Label|delay:30|Check build
-->`;

    const result = parseSuggestedPrompts(content);

    expect(result.prompts.length).toBe(1);
    expect(result.prompts[0]).toBe('Check build');
  });

  it('should strip delay prefix case-insensitively', () => {
    const content = `<!-- suggested-prompts
DELAY:120|Check CI
-->`;

    const result = parseSuggestedPrompts(content);

    expect(result.prompts.length).toBe(1);
    expect(result.prompts[0]).toBe('Check CI');
  });

  it('should parse mixed instant and delay-prefixed prompts as plain strings', () => {
    const content = `<!-- suggested-prompts
Run tests now
delay:60|Check deployment
Label|delay:30|Check build
Another plain prompt
-->`;

    const result = parseSuggestedPrompts(content);

    expect(result.prompts.length).toBe(4);
    expect(result.prompts[0]).toBe('Run tests now');
    expect(result.prompts[1]).toBe('Check deployment');
    expect(result.prompts[2]).toBe('Check build');
    expect(result.prompts[3]).toBe('Another plain prompt');
  });

  it('should filter out empty delay text', () => {
    const content = `<!-- suggested-prompts
delay:60|
Valid prompt
-->`;

    const result = parseSuggestedPrompts(content);

    expect(result.prompts).toEqual(['Valid prompt']);
  });

  it('should return empty array and unchanged content when no suggested-prompts block', () => {
    const content = 'This is just regular content without any prompts block.';

    const result = parseSuggestedPrompts(content);

    expect(result.prompts).toEqual([]);
    expect(result.cleanedContent).toBe(content);
  });

  it('should strip the suggested-prompts block from cleanedContent', () => {
    const content = `Here is the main message.

<!-- suggested-prompts
Run tests
Review code
-->

Some trailing content.`;

    const result = parseSuggestedPrompts(content);

    expect(result.cleanedContent).not.toContain('suggested-prompts');
    expect(result.cleanedContent).not.toContain('Run tests');
    expect(result.cleanedContent).not.toContain('Review code');
    expect(result.cleanedContent).toContain('Here is the main message.');
    expect(result.cleanedContent).toContain('Some trailing content.');
  });

  it('should handle empty input', () => {
    const result = parseSuggestedPrompts('');

    expect(result.prompts).toEqual([]);
    expect(result.cleanedContent).toBe('');
  });
});
