<script lang="ts">
  import { writable } from 'svelte/store';
  import { selectAgentCreationRequest } from '$store/renderer/slices/workspace-agents/workspace-agents-selectors';
  import { usePanelActions } from '../use-panel-actions.svelte';

  interface Props {
    openDrawer: (type: string, agentId: string) => void;
    markAgentRecentlyCreated: (agentId: string) => void;
    onDraftPromptSet: (prompt: string | null) => void;
  }

  const { openDrawer, markAgentRecentlyCreated, onDraftPromptSet }: Props = $props();
  const workspaceId = writable('');
  const requestId = writable('');
  const agentCreationRequest = selectAgentCreationRequest(workspaceId, requestId);
  const actions = usePanelActions({
    workspace: () => ({ id: 'ws-1', title: 'Workspace' }) as never,
    workspaceState: () =>
      ({
        openFile: () => Promise.resolve(),
        openNote: () => Promise.resolve(),
        openDrawer,
        closeDrawer: () => {},
        state: { workspace: { id: 'ws-1' } },
      }) as never,
    state: () => ({ drawer: { open: false } }) as never,
    markAgentRecentlyCreated: (agentId) => markAgentRecentlyCreated(agentId),
    onDraftPromptSet: (prompt) => onDraftPromptSet(prompt),
    agentCreationRequest,
    setAgentCreationRequestContext: (nextWorkspaceId, nextRequestId) => {
      workspaceId.set(nextWorkspaceId);
      requestId.set(nextRequestId);
    },
  });
</script>

<button onclick={() => actions.handleCreateAgentWithPrompt('Draft prompt', 'Prompt Agent')}>
  Create prompt agent
</button>
