<script lang="ts">
  import CodeEditor from '$lib/components/editor/CodeEditor.svelte';
  import InlinePermissionRequest from '../InlinePermissionRequest.svelte';
  import AskUserQuestions from '$lib/components/ui/ask-user-questions/ask-user-questions.svelte';
  import type { PermissionRequest } from '$store/renderer/slices/permission/permission-slice';
  import { onMount } from 'svelte';

  let { surface }: { surface: 'permission' | 'questions' } = $props();

  let value = $state('');
  // Keys a page-level shortcut claimed. Children attach their window listeners
  // first, so this later bubble listener observes their preventDefault.
  let claimedKeys = $state('');

  onMount(() => {
    const record = (event: KeyboardEvent) => {
      if (event.defaultPrevented) claimedKeys += event.key;
    };
    window.addEventListener('keydown', record);
    return () => window.removeEventListener('keydown', record);
  });

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
  <output data-testid="claimed-keys">{claimedKeys}</output>
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
