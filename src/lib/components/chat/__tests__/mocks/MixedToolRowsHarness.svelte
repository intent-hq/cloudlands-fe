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
        type: 'tool_use',
        id: 'read-a',
        name: 'view',
        input: {
          path: '/Users/example/repository/src/lib/components/chat/tool-classifier.ts',
          view_range: [1, 120],
        },
      },
      result: 'file contents',
    },
    {
      toolUse: {
        type: 'tool_use',
        id: 'search-file',
        name: 'view',
        input: {
          path: '/Users/example/repository/messages/en.json',
          search_query_regex: 'chat_toolCall',
        },
      },
      result: 'message matches',
    },
    {
      toolUse: {
        type: 'tool_use',
        id: 'read-b',
        name: 'view',
        input: { path: '/Users/example/repository/src/lib/components/chat/ToolDetails.svelte' },
      },
      result: 'file contents',
    },
    {
      toolUse: {
        type: 'tool_use',
        id: 'grep',
        name: 'launch-process',
        input: { command: 'grep -R "Completed" src/lib/components/chat' },
      },
      result: 'matches',
    },
    {
      toolUse: {
        type: 'tool_use',
        id: 'context',
        name: 'codebase-retrieval',
        input: { information_request: 'compact tool-call rendering' },
      },
      result: 'Retrieved result',
    },
    {
      toolUse: {
        type: 'tool_use',
        id: 'conflicts',
        name: 'workspace_api',
        input: {
          summary: 'Check tool-row ownership conflicts',
          code: 'return await ws.agent.list()',
        },
      },
      result: { agents: [] },
    },
    {
      toolUse: {
        type: 'tool_use',
        id: 'session-name',
        name: 'workspace_api',
        input: {
          summary: 'Name compact tool-row session',
          code: 'return await ws.workspace.setAgentName("Compact tool rows")',
        },
      },
      result: { ok: true },
    },
    {
      toolUse: {
        type: 'tool_use',
        id: 'delegate',
        name: 'delegate_task_workspace-mcp',
        input: { taskText: 'Verify compact tool rows' },
      },
      result: 'Task delegated to renderer verifier',
    },
    {
      toolUse: {
        type: 'tool_use',
        id: 'requirements',
        name: 'workspace_api',
        input: {
          summary: 'Read compact tool-row requirements',
          code: 'return await ws.task.getMyTask("task-1")',
        },
      },
      result: { title: 'Compact tool rows' },
    },
    {
      toolUse: {
        type: 'tool_use',
        id: 'complete',
        name: 'workspace_api',
        input: {
          summary: 'Complete compact tool-row task',
          code: 'return await ws.task.updateNoteStatus("task-1", "complete")',
        },
      },
      result: { ok: true },
    },
    {
      toolUse: {
        type: 'tool_use',
        id: 'error',
        name: 'launch-process',
        input: { command: 'pnpm vitest run broken.test.ts' },
      },
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
