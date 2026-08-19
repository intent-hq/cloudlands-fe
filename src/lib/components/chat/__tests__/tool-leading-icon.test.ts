import { describe, expect, it } from 'vitest';
import { resolveToolLeadingIcon, type ToolLeadingIconMetadata } from '../tool-leading-icon';

describe('tool leading icon resolver', () => {
  it.each<[string, ToolLeadingIconMetadata]>([
    ['built-in view', { toolName: 'view' }],
    ['built-in read process', { toolName: 'read-process' }],
    ['built-in list processes', { toolName: 'list-processes' }],
    ['context engine', { toolName: 'codebase-retrieval', category: 'context-engine' }],
    ['file search', { toolName: 'grep-search', category: 'search' }],
    ['web search', { toolName: 'web-search' }],
    ['web fetch', { toolName: 'web-fetch' }],
    ['browser screenshot', { toolName: 'browser', action: 'screenshot' }],
    ['browser status', { toolName: 'browser-status' }],
    ['file metadata', { toolName: 'get-file-status' }],
    ['workspace read action', { toolName: 'workspace_api', action: 'read' }],
    ['note read', { toolName: 'note-read' }],
    ['task get', { toolName: 'task-get' }],
    ['MCP Figma screenshot', { toolName: 'mcp__figma__get_screenshot' }],
    ['MCP GitHub search', { toolName: 'mcp__github__search_issues' }],
    ['explicit read category', { toolName: 'custom', category: 'file-read' }],
  ])('uses eye for %s', (_name, metadata) => {
    expect(resolveToolLeadingIcon(metadata)).toBe('eye');
  });

  it.each<[string, ToolLeadingIconMetadata]>([
    ['built-in write', { toolName: 'write-file' }],
    ['built-in edit', { toolName: 'str-replace-editor' }],
    ['built-in delete', { toolName: 'remove-files' }],
    ['built-in create', { toolName: 'create-agent' }],
    ['workspace mutation', { toolName: 'workspace_api', action: 'update' }],
    ['note add', { toolName: 'note-add' }],
    ['task update', { toolName: 'task-update-status' }],
    ['browser navigation', { toolName: 'browser', action: 'navigate' }],
    ['browser evaluation', { toolName: 'browser', action: 'evaluate' }],
    ['mixed browser actions', { toolName: 'browser', action: ['screenshot', 'navigate'] }],
    ['terminal launch', { toolName: 'launch-process' }],
    ['terminal write', { toolName: 'write-process' }],
    ['MCP GitHub create', { toolName: 'mcp__github__create_issue' }],
    ['MCP Slack send', { toolName: 'mcp__slack__send_message' }],
    ['unknown tool', { toolName: 'custom-tool' }],
    ['missing name', { toolName: undefined }],
  ])('uses hand for %s', (_name, metadata) => {
    expect(resolveToolLeadingIcon(metadata)).toBe('hand');
  });

  it('lets canonical mutation metadata override an observe word', () => {
    expect(resolveToolLeadingIcon({ toolName: 'read-and-update', category: 'file-read' })).toBe(
      'hand',
    );
  });
});
