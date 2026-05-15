import {
  describe,
  it,
  expect,
} from 'vitest';
import { exportChatToHtml } from './chat-html-exporter';
import type { AgentMessage } from '$shared/types';

describe('exportChatToHtml', () => {
  it('should export empty messages array', () => {
    const html = exportChatToHtml([], { title: 'Test Chat' });
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('Test Chat');
    expect(html).toContain('No messages to export');
  });

  it('should export a simple user message', () => {
    const messages: AgentMessage[] = [
      {
        id: 'msg-1',
        role: 'user',
        contentBlocks: [{ type: 'text', text: 'Hello, assistant!' }],
        timestamp: new Date('2024-01-01T12:00:00Z'),
      },
    ];

    const html = exportChatToHtml(messages, { title: 'Test Chat' });
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('Hello, assistant!');
    expect(html).toContain('class="message user"');
  });

  it('should export assistant message with code block', () => {
    const messages: AgentMessage[] = [
      {
        id: 'msg-1',
        role: 'assistant',
        contentBlocks: [
          { type: 'text', text: 'Here is some code:' },
          { type: 'code', text: 'console.log("hello");', language: 'javascript' },
        ],
        timestamp: new Date('2024-01-01T12:00:00Z'),
      },
    ];

    const html = exportChatToHtml(messages, { title: 'Test Chat' });
    expect(html).toContain('Here is some code:');
    expect(html).toContain('console.log(&quot;hello&quot;);'); // Code should be HTML-escaped
    expect(html).toContain('class="code-block"');
    expect(html).toContain('data-language="javascript"');
  });

  it('should export message with tool calls', () => {
    const messages: AgentMessage[] = [
      {
        id: 'msg-1',
        role: 'assistant',
        contentBlocks: [{ type: 'text', text: 'I will read a file' }],
        toolCalls: [
          {
            id: 'tool-1',
            name: 'read_file_workspace-mcp',
            arguments: { path: 'src/main.ts' },
          },
        ],
        timestamp: new Date('2024-01-01T12:00:00Z'),
      },
    ];

    const html = exportChatToHtml(messages, { title: 'Test Chat' });
    expect(html).toContain('I will read a file');
    expect(html).toContain('read_file');
    expect(html).toContain('src/main.ts');
    expect(html).toContain('class="tool-call"');
  });

  it('should export message with tool results', () => {
    const messages: AgentMessage[] = [
      {
        id: 'msg-1',
        role: 'assistant',
        contentBlocks: [{ type: 'text', text: 'File read successfully' }],
        toolResults: [
          {
            toolCallId: 'tool-1',
            content: 'File contents here',
          },
        ],
        timestamp: new Date('2024-01-01T12:00:00Z'),
      },
    ];

    const html = exportChatToHtml(messages, { title: 'Test Chat' });
    expect(html).toContain('File read successfully');
    expect(html).toContain('File contents here');
    expect(html).toContain('class="tool-result"');
  });

  it('should include theme toggle button', () => {
    const html = exportChatToHtml([], { title: 'Test Chat' });
    expect(html).toContain('class="theme-toggle"');
    expect(html).toContain('toggleTheme()');
    expect(html).toContain('localStorage');
  });

  it('should include CSS for light and dark themes', () => {
    const html = exportChatToHtml([], { title: 'Test Chat' });
    expect(html).toContain('--bg-primary');
    expect(html).toContain('--text-primary');
    expect(html).toContain(':root.dark');
  });

  it('should escape HTML special characters', () => {
    const messages: AgentMessage[] = [
      {
        id: 'msg-1',
        role: 'user',
        contentBlocks: [{ type: 'text', text: '<script>alert("xss")</script>' }],
        timestamp: new Date('2024-01-01T12:00:00Z'),
      },
    ];

    const html = exportChatToHtml(messages, { title: 'Test Chat' });
    // User-provided script tags should be escaped
    expect(html).toContain('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
    // But the template's script tag should still be there for theme toggle
    expect(html).toContain('function toggleTheme()');
  });

  it('should include turn numbers when present', () => {
    const messages: AgentMessage[] = [
      {
        id: 'msg-1',
        role: 'user',
        contentBlocks: [{ type: 'text', text: 'First message' }],
        timestamp: new Date('2024-01-01T12:00:00Z'),
        turnNumber: 1,
      },
    ];

    const html = exportChatToHtml(messages, { title: 'Test Chat' });
    expect(html).toContain('Turn 1');
  });

  it('should handle undefined text in content blocks', () => {
    const messages: AgentMessage[] = [
      {
        id: 'msg-1',
        role: 'assistant',
        contentBlocks: [
          { type: 'text', text: undefined },
          { type: 'code', text: undefined, language: 'javascript' },
        ],
        timestamp: new Date('2024-01-01T12:00:00Z'),
      },
    ];

    // Should not throw an error
    const html = exportChatToHtml(messages, { title: 'Test Chat' });
    expect(html).toContain('<!DOCTYPE html>');
  });

  it('should handle undefined tool names', () => {
    const messages: AgentMessage[] = [
      {
        id: 'msg-1',
        role: 'assistant',
        contentBlocks: [{ type: 'text', text: 'Calling tool' }],
        toolCalls: [
          {
            id: 'tool-1',
            name: undefined,
            arguments: { path: 'src/main.ts' },
          },
        ],
        timestamp: new Date('2024-01-01T12:00:00Z'),
      },
    ];

    // Should not throw an error
    const html = exportChatToHtml(messages, { title: 'Test Chat' });
    expect(html).toContain('<!DOCTYPE html>');
  });

  it('should handle null content blocks', () => {
    const messages: AgentMessage[] = [
      {
        id: 'msg-1',
        role: 'assistant',
        contentBlocks: [
          { type: 'text', text: null },
        ],
        timestamp: new Date('2024-01-01T12:00:00Z'),
      },
    ];

    // Should not throw an error
    const html = exportChatToHtml(messages, { title: 'Test Chat' });
    expect(html).toContain('<!DOCTYPE html>');
  });
});
