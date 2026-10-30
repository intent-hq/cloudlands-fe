<script lang="ts">
  import CodeEditor from '$lib/components/editor/CodeEditor.svelte';
  import InlinePermissionRequest from '../InlinePermissionRequest.svelte';
  import AskUserQuestions from '$lib/components/ui/ask-user-questions/ask-user-questions.svelte';
  import type { PermissionRequest } from '$store/renderer/slices/permission/permission-slice';

  let { surface }: { surface: 'permission' | 'questions' } = $props();

  let value = $state('');

  const request: PermissionRequest = {
    requestId: 'text-entry-permission',
    sessionId: 'text-entry-session',
    workspaceId: 'text-entry-workspace',
    title: 'Run command',
    description: 'echo fixture',
    options: [
      { id: 'allow_once', label: 'Allow' },
      { id: 'reject_once', label: 'Deny', destructive: true },
    ],
    timestamp: 0,
  };
</script>

<div style="display: grid; gap: 16px; width: 640px;">
  <div style="height: 160px;">
    <CodeEditor bind:value language="plaintext" />
  </div>
  <output data-testid="editor-value">{value}</output>
  {#if surface === 'permission'}
    <InlinePermissionRequest {request} keyboardShortcutsEnabled />
  {:else}
    <AskUserQuestions
      questions={[
        {
          id: 'choice',
          title: 'Pick some',
          multiSelect: true,
          options: [
            { id: 'first', title: 'First' },
            { id: 'second', title: 'Second' },
          ],
        },
      ]}
    />
  {/if}
</div>
