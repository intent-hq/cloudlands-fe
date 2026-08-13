<script lang="ts">
  import type { ToolUseBlock } from '$shared/types';
  import ThinkingBlock from '../../ThinkingBlock.svelte';
  import ToolCall from '../../ToolCall.svelte';

  const calls: Array<{
    toolUse: ToolUseBlock;
    toolState?: 'running' | 'completed' | 'error';
    result?: unknown;
  }> = [
    {
      toolUse: {
        id: 'read-a',
        name: 'view',
        input: {
          path: '/Users/example/repository/src/lib/components/chat/tool-classifier.ts',
          view_range: [1, 120],
        },
      } as ToolUseBlock,
      result: 'file contents',
    },
    {
      toolUse: {
        id: 'search-file',
        name: 'view',
        input: {
          path: '/Users/example/repository/messages/en.json',
          search_query_regex: 'chat_toolCall',
        },
      } as ToolUseBlock,
      result: 'message matches',
    },
    {
      toolUse: {
        id: 'read-b',
        name: 'view',
        input: { path: '/Users/example/repository/src/lib/components/chat/ToolDetails.svelte' },
      } as ToolUseBlock,
      result: 'file contents',
    },
    {
      toolUse: {
        id: 'grep',
        name: 'launch-process',
        input: { command: 'grep -R "Completed" src/lib/components/chat' },
      } as ToolUseBlock,
      result: 'matches',
    },
    {
      toolUse: {
        id: 'context',
        name: 'codebase-retrieval',
        input: { information_request: 'compact tool-call rendering' },
      } as ToolUseBlock,
      result: 'Retrieved result',
    },
    {
      toolUse: {
        id: 'conflicts',
        name: 'workspace_api',
        input: {
          summary: 'Check tool-row ownership conflicts',
          code: 'return await ws.agent.list()',
        },
      } as ToolUseBlock,
      result: { agents: [] },
    },
    {
      toolUse: {
        id: 'session-name',
        name: 'workspace_api',
        input: {
          summary: 'Name compact tool-row session',
          code: 'return await ws.workspace.setAgentName("Compact tool rows")',
        },
      } as ToolUseBlock,
      result: { ok: true },
    },
    {
      toolUse: {
        id: 'delegate',
        name: 'delegate_task_workspace-mcp',
        input: { taskText: 'Verify compact tool rows' },
      } as ToolUseBlock,
      result: 'Task delegated to renderer verifier',
    },
    {
      toolUse: {
        id: 'requirements',
        name: 'workspace_api',
        input: {
          summary: 'Read compact tool-row requirements',
          code: 'return await ws.task.getMyTask("task-1")',
        },
      } as ToolUseBlock,
      result: { title: 'Compact tool rows' },
    },
    {
      toolUse: {
        id: 'complete',
        name: 'workspace_api',
        input: {
          summary: 'Complete compact tool-row task',
          code: 'return await ws.task.updateNoteStatus("task-1", "complete")',
        },
      } as ToolUseBlock,
      result: { ok: true },
    },
    {
      toolUse: {
        id: 'error',
        name: 'launch-process',
        input: { command: 'pnpm vitest run broken.test.ts' },
      } as ToolUseBlock,
      result: 'Test file failed',
      toolState: 'error',
    },
  ];
</script>

<div class="w-full min-w-0 max-w-full overflow-hidden" data-testid="mixed-tool-sequence">
  {#each calls as call (call.toolUse.id)}
    <ToolCall
      toolUse={call.toolUse}
      toolState={call.toolState ?? 'completed'}
      result={call.result}
      workspaceId="ws-1"
    />
  {/each}
  <ThinkingBlock content="Check every collapsed tool row against the screenshot." isStreaming />
</div>
