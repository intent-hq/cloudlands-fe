import { describe, it, expect } from 'vitest';
import {
  cleanAgentMessage,
  parseAgentMessage,
  parseSuggestedPrompts,
  groupParsedBlocks,
  groupContentBlocks,
} from '../messageParser';
import type { GroupedBlock, ContentBlockGroup } from '../messageParser';
import type { ContentBlock } from '$shared/types/content-block';

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


describe('parseAgentMessage - group tags', () => {
  // NOTE: Group tags are now handled at the ContentBlock level by groupContentBlocks().
  // parseAgentMessage() no longer extracts group markers — group tags are treated as plain text.
  // The tests below verify that group tags pass through as text content.

  it('should treat group tags as plain text (no longer extracted)', () => {
    const input = '<group:Test>content here</group:Test>';
    const result = parseAgentMessage(input);

    // Group tags are now plain text — no group_start/group_end markers
    expect(result.every((b) => b.type !== 'group_start' && b.type !== 'group_end')).toBe(true);
    // The content should contain the group tags as text
    const allText = result.map((b) => b.content).join('');
    expect(allText).toContain('content here');
  });

  it('should treat short close tags as plain text', () => {
    const input = '<group:Test>content here</group>';
    const result = parseAgentMessage(input);

    expect(result.every((b) => b.type !== 'group_start' && b.type !== 'group_end')).toBe(true);
    const allText = result.map((b) => b.content).join('');
    expect(allText).toContain('content here');
  });

  it('should treat multiple sequential groups as plain text', () => {
    const input = '<group:First>content 1</group:First>\n<group:Second>content 2</group:Second>';
    const result = parseAgentMessage(input);

    expect(result.every((b) => b.type !== 'group_start' && b.type !== 'group_end')).toBe(true);
    const allText = result.map((b) => b.content).join('');
    expect(allText).toContain('content 1');
    expect(allText).toContain('content 2');
  });

  it('should treat unclosed group as plain text', () => {
    const input = '<group:Streaming>partial content being streamed';
    const result = parseAgentMessage(input);

    expect(result.every((b) => b.type !== 'group_start')).toBe(true);
    const allText = result.map((b) => b.content).join('');
    expect(allText).toContain('partial content being streamed');
  });

  it('should treat malformed/partial tags as text', () => {
    const input = 'This has a <group without closing bracket and some text';
    const result = parseAgentMessage(input);

    // Should be treated as plain text since <group without : is not a valid tag
    expect(result.length).toBe(1);
    expect(result[0].type).toBe('text');
    expect(result[0].content).toContain('<group without closing bracket');
  });

  it('should treat incomplete group tag syntax as text', () => {
    const input = 'Text with </group and more text';
    const result = parseAgentMessage(input);

    // </group without > is not a valid close tag
    expect(result.length).toBe(1);
    expect(result[0].type).toBe('text');
    expect(result[0].content).toContain('</group');
  });

  it('should handle group containing code blocks (tags treated as text)', () => {
    const input = `<group:Implementation>
Here is the code:

\`\`\`typescript path=src/app.ts
const x = 1;
\`\`\`

Done with implementation.
</group:Implementation>`;

    const result = parseAgentMessage(input);

    // Group tags are now plain text, but code blocks are still parsed
    const types = result.map((b) => b.type);
    expect(types).not.toContain('group_start');
    expect(types).not.toContain('group_end');
    expect(types).toContain('augment_code_snippet');
  });
});

describe('groupParsedBlocks', () => {
  // NOTE: parseAgentMessage() no longer produces group_start/group_end markers.
  // Group tags are now handled at the ContentBlock level by groupContentBlocks().
  // These tests construct input manually to test groupParsedBlocks() in isolation.

  it('should transform flat blocks with group markers into grouped structure', () => {
    const input: ParsedContent[] = [
      { type: 'group_start', content: '', metadata: { groupName: 'Test', isStreaming: false } },
      { type: 'text', content: 'content here' },
      { type: 'group_end', content: '', metadata: { groupName: 'Test' } },
    ];
    const result = groupParsedBlocks(input);

    expect(result.length).toBe(1);
    expect(result[0].type).toBe('group');
    const group = result[0] as GroupedBlock;
    expect(group.name).toBe('Test');
    expect(group.isStreaming).toBe(false);
    expect(group.children.length).toBe(1);
    expect(group.children[0].type).toBe('text');
    expect(group.children[0].content).toBe('content here');
  });

  it('should pass through non-grouped content', () => {
    const input: ParsedContent[] = [
      { type: 'text', content: 'Just plain text without groups' },
    ];
    const result = groupParsedBlocks(input);

    expect(result.length).toBe(1);
    expect(result[0].type).toBe('text');
  });

  it('should handle mixed grouped and ungrouped content', () => {
    const input: ParsedContent[] = [
      { type: 'text', content: 'Before' },
      { type: 'group_start', content: '', metadata: { groupName: 'A', isStreaming: false } },
      { type: 'text', content: 'inside' },
      { type: 'group_end', content: '', metadata: { groupName: 'A' } },
      { type: 'text', content: 'After' },
    ];
    const result = groupParsedBlocks(input);

    // Should be: text("Before"), group("A"), text("After")
    expect(result[0].type).toBe('text');
    expect(result[1].type).toBe('group');
    const group = result[1] as GroupedBlock;
    expect(group.name).toBe('A');
    expect(group.children[0].content).toBe('inside');
    expect(result[2].type).toBe('text');
  });

  it('should handle streaming (unclosed) groups', () => {
    const input: ParsedContent[] = [
      { type: 'group_start', content: '', metadata: { groupName: 'Loading', isStreaming: true } },
      { type: 'text', content: 'streaming content...' },
    ];
    const result = groupParsedBlocks(input);

    expect(result.length).toBe(1);
    expect(result[0].type).toBe('group');
    const group = result[0] as GroupedBlock;
    expect(group.name).toBe('Loading');
    expect(group.isStreaming).toBe(true);
    expect(group.children.length).toBe(1);
    expect(group.children[0].content).toBe('streaming content...');
  });

  it('should handle multiple sequential groups', () => {
    const input: ParsedContent[] = [
      { type: 'group_start', content: '', metadata: { groupName: 'A', isStreaming: false } },
      { type: 'text', content: 'content A' },
      { type: 'group_end', content: '', metadata: { groupName: 'A' } },
      { type: 'group_start', content: '', metadata: { groupName: 'B', isStreaming: false } },
      { type: 'text', content: 'content B' },
      { type: 'group_end', content: '', metadata: { groupName: 'B' } },
    ];
    const result = groupParsedBlocks(input);

    const groups = result.filter((b) => b.type === 'group') as GroupedBlock[];
    expect(groups.length).toBe(2);
    expect(groups[0].name).toBe('A');
    expect(groups[1].name).toBe('B');
  });

  it('should skip stray group_end markers', () => {
    const input: ParsedContent[] = [
      { type: 'text', content: 'text' },
      { type: 'group_end', content: '', metadata: { groupName: 'Stray' } },
      { type: 'text', content: 'more text' },
    ];
    const result = groupParsedBlocks(input);

    // The stray group_end should be consumed, text around it preserved
    const types = result.map((b) => b.type);
    expect(types).not.toContain('group_end');
    // Should have text blocks
    expect(result.some((b) => b.type === 'text')).toBe(true);
  });
});


describe('groupContentBlocks', () => {
  // Helper to create ContentBlock
  function textBlock(text: string): ContentBlock {
    return { type: 'text', text } as ContentBlock;
  }
  function toolUseBlock(name: string, id: string): ContentBlock {
    return { type: 'tool_use', name, id, input: {} } as ContentBlock;
  }
  function toolResultBlock(id: string, text: string): ContentBlock {
    return { type: 'tool_result', tool_use_id: id, content: text } as ContentBlock;
  }
  function thinkingBlock(text: string): ContentBlock {
    return { type: 'thinking', text } as ContentBlock;
  }

  it('should pass through blocks unchanged when no groups', () => {
    const blocks: ContentBlock[] = [
      textBlock('Hello world'),
      toolUseBlock('view', 'tool-1'),
      toolResultBlock('tool-1', 'result'),
      textBlock('Done'),
    ];
    const result = groupContentBlocks(blocks);

    expect(result.length).toBe(4);
    expect(result[0].type).toBe('text');
    expect(result[1].type).toBe('tool_use');
    expect(result[2].type).toBe('tool_result');
    expect(result[3].type).toBe('text');
  });

  it('should group text blocks within a single group', () => {
    const blocks: ContentBlock[] = [
      textBlock('<group:Research>Finding files...</group:Research>'),
    ];
    const result = groupContentBlocks(blocks);

    expect(result.length).toBe(1);
    expect(result[0].type).toBe('content_group');
    const group = result[0] as ContentBlockGroup;
    expect(group.name).toBe('Research');
    expect(group.isStreaming).toBe(false);
    expect(group.children.length).toBe(1);
    expect(group.children[0].type).toBe('text');
    expect(group.children[0].text).toBe('Finding files...');
  });

  it('should group text + tool_use + tool_result blocks', () => {
    const blocks: ContentBlock[] = [
      textBlock('<group:Implementation>Starting work'),
      toolUseBlock('str-replace-editor', 'tool-1'),
      toolResultBlock('tool-1', 'File edited'),
      textBlock('Done editing</group:Implementation>'),
    ];
    const result = groupContentBlocks(blocks);

    expect(result.length).toBe(1);
    expect(result[0].type).toBe('content_group');
    const group = result[0] as ContentBlockGroup;
    expect(group.name).toBe('Implementation');
    expect(group.isStreaming).toBe(false);
    expect(group.children.length).toBe(4);
    expect(group.children[0].type).toBe('text');
    expect(group.children[0].text).toBe('Starting work');
    expect(group.children[1].type).toBe('tool_use');
    expect(group.children[2].type).toBe('tool_result');
    expect(group.children[3].type).toBe('text');
    expect(group.children[3].text).toBe('Done editing');
  });

  it('should group text + thinking blocks', () => {
    const blocks: ContentBlock[] = [
      textBlock('<group:Analysis>Let me think...'),
      thinkingBlock('Considering the options...'),
      textBlock('I have decided.</group:Analysis>'),
    ];
    const result = groupContentBlocks(blocks);

    expect(result.length).toBe(1);
    expect(result[0].type).toBe('content_group');
    const group = result[0] as ContentBlockGroup;
    expect(group.name).toBe('Analysis');
    expect(group.children.length).toBe(3);
    expect(group.children[0].text).toBe('Let me think...');
    expect(group.children[1].type).toBe('thinking');
    expect(group.children[2].text).toBe('I have decided.');
  });

  it('should handle multiple groups in sequence', () => {
    const blocks: ContentBlock[] = [
      textBlock('<group:First>content 1</group:First>'),
      textBlock('<group:Second>content 2</group:Second>'),
    ];
    const result = groupContentBlocks(blocks);

    expect(result.length).toBe(2);
    expect(result[0].type).toBe('content_group');
    expect(result[1].type).toBe('content_group');
    const g1 = result[0] as ContentBlockGroup;
    const g2 = result[1] as ContentBlockGroup;
    expect(g1.name).toBe('First');
    expect(g2.name).toBe('Second');
    expect(g1.children[0].text).toBe('content 1');
    expect(g2.children[0].text).toBe('content 2');
  });

  it('should split text before and after group tags', () => {
    const blocks: ContentBlock[] = [
      textBlock('Before text <group:Middle>inside group</group:Middle> After text'),
    ];
    const result = groupContentBlocks(blocks);

    expect(result.length).toBe(3);
    expect(result[0].type).toBe('text');
    expect((result[0] as ContentBlock).text).toBe('Before text');
    expect(result[1].type).toBe('content_group');
    const group = result[1] as ContentBlockGroup;
    expect(group.name).toBe('Middle');
    expect(group.children[0].text).toBe('inside group');
    expect(result[2].type).toBe('text');
    expect((result[2] as ContentBlock).text).toBe('After text');
  });

  it('should mark unclosed group as streaming when isStreaming=true', () => {
    const blocks: ContentBlock[] = [
      textBlock('<group:Loading>partial content...'),
      toolUseBlock('search', 'tool-1'),
    ];
    const result = groupContentBlocks(blocks, true);

    expect(result.length).toBe(1);
    expect(result[0].type).toBe('content_group');
    const group = result[0] as ContentBlockGroup;
    expect(group.name).toBe('Loading');
    expect(group.isStreaming).toBe(true);
    expect(group.children.length).toBe(2);
    expect(group.children[0].text).toBe('partial content...');
    expect(group.children[1].type).toBe('tool_use');
  });

  it('should auto-close unclosed group gracefully when isStreaming=false', () => {
    const blocks: ContentBlock[] = [
      textBlock('<group:Unclosed>some content'),
      toolUseBlock('view', 'tool-1'),
    ];
    const result = groupContentBlocks(blocks, false);

    expect(result.length).toBe(1);
    expect(result[0].type).toBe('content_group');
    const group = result[0] as ContentBlockGroup;
    expect(group.name).toBe('Unclosed');
    expect(group.isStreaming).toBe(false);
    expect(group.children.length).toBe(2);
  });

  it('should auto-close previous group when new group opens', () => {
    const blocks: ContentBlock[] = [
      textBlock('<group:First>content 1'),
      toolUseBlock('view', 'tool-1'),
      textBlock('<group:Second>content 2</group:Second>'),
    ];
    const result = groupContentBlocks(blocks);

    expect(result.length).toBe(2);
    const g1 = result[0] as ContentBlockGroup;
    const g2 = result[1] as ContentBlockGroup;
    expect(g1.type).toBe('content_group');
    expect(g1.name).toBe('First');
    expect(g1.isStreaming).toBe(false); // auto-closed, not streaming
    expect(g1.children.length).toBe(2); // text + tool_use
    expect(g2.type).toBe('content_group');
    expect(g2.name).toBe('Second');
    expect(g2.children[0].text).toBe('content 2');
  });

  it('should handle short close tag </group>', () => {
    const blocks: ContentBlock[] = [
      textBlock('<group:Test>content</group>'),
    ];
    const result = groupContentBlocks(blocks);

    expect(result.length).toBe(1);
    expect(result[0].type).toBe('content_group');
    const group = result[0] as ContentBlockGroup;
    expect(group.name).toBe('Test');
    expect(group.isStreaming).toBe(false);
    expect(group.children[0].text).toBe('content');
  });

  it('should handle named close tag </group:Name>', () => {
    const blocks: ContentBlock[] = [
      textBlock('<group:MyGroup>content</group:MyGroup>'),
    ];
    const result = groupContentBlocks(blocks);

    expect(result.length).toBe(1);
    expect(result[0].type).toBe('content_group');
    const group = result[0] as ContentBlockGroup;
    expect(group.name).toBe('MyGroup');
    expect(group.isStreaming).toBe(false);
  });

  it('should handle empty group (open immediately followed by close)', () => {
    const blocks: ContentBlock[] = [
      textBlock('<group:Empty></group:Empty>'),
    ];
    const result = groupContentBlocks(blocks);

    expect(result.length).toBe(1);
    expect(result[0].type).toBe('content_group');
    const group = result[0] as ContentBlockGroup;
    expect(group.name).toBe('Empty');
    expect(group.isStreaming).toBe(false);
    expect(group.children.length).toBe(0);
  });

  it('should not process group tags inside non-text blocks', () => {
    // tool_use blocks with group-like strings in their input should pass through
    const blocks: ContentBlock[] = [
      { type: 'tool_use', name: 'write', id: 'tool-1', input: { content: '<group:Fake>test</group>' } } as ContentBlock,
    ];
    const result = groupContentBlocks(blocks);

    expect(result.length).toBe(1);
    expect(result[0].type).toBe('tool_use');
  });

  it('should handle group spanning multiple text blocks with tool blocks between', () => {
    const blocks: ContentBlock[] = [
      textBlock('Before'),
      textBlock('<group:Work>Starting'),
      toolUseBlock('edit', 'tool-1'),
      toolResultBlock('tool-1', 'edited'),
      thinkingBlock('Hmm...'),
      textBlock('Finishing</group:Work>'),
      textBlock('After'),
    ];
    const result = groupContentBlocks(blocks);

    expect(result.length).toBe(3); // Before, group, After
    expect(result[0].type).toBe('text');
    expect((result[0] as ContentBlock).text).toBe('Before');
    expect(result[1].type).toBe('content_group');
    const group = result[1] as ContentBlockGroup;
    expect(group.name).toBe('Work');
    expect(group.children.length).toBe(5); // Starting, tool_use, tool_result, thinking, Finishing
    expect(group.children[0].text).toBe('Starting');
    expect(group.children[1].type).toBe('tool_use');
    expect(group.children[2].type).toBe('tool_result');
    expect(group.children[3].type).toBe('thinking');
    expect(group.children[4].text).toBe('Finishing');
    expect(result[2].type).toBe('text');
    expect((result[2] as ContentBlock).text).toBe('After');
  });
});
