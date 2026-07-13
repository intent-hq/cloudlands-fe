<script lang="ts">
  import {
  onMount,
  onDestroy,
} from 'svelte';
  import { createLogger } from '$lib/utils/client-logger';
  import AuggieAvatar from '$lib/components/ui/auggie-avatar/AuggieAvatar.svelte';
  import Button from '$lib/components/ui/button/button.svelte';
  import CodeEditor from '$lib/components/editor/CodeEditor.svelte';
  import { appClient } from '$lib/client';
  import {
  faTimes,
  faCheck,
} from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';

  const logger = createLogger('SetupScriptAgent');

  interface Props {
    repoPath: string;
    onScriptGenerated?: (script: { name: string; description: string; content: string }) => void;
    onClose?: () => void;
  }

  let { repoPath, onScriptGenerated, onClose }: Props = $props();

  let agentId = $state(crypto.randomUUID());
  let isGenerating = $state(false);
  let error = $state<string | null>(null);
  let isComponentMounted = false;
  let generatedScript = $state<{ name: string; description: string; content: string } | null>(null);

  // Generate the draft when mounted
  onMount(() => {
    isComponentMounted = true;
    void generate();
  });

  onDestroy(() => {
    isComponentMounted = false;
  });

  /** Resolve the workspace whose repository/worktree matches this repo path. */
  async function resolveWorkspaceId(): Promise<string | null> {
    try {
      const workspaces = await appClient.workspaces.list();
      const match = workspaces.find(
        (w) => w.repositoryPath === repoPath || w.path === repoPath || w.worktreePath === repoPath,
      );
      return match ? String(match.id) : null;
    } catch {
      return null;
    }
  }

  /**
   * `workspace.generateSetupScript` (PROTOCOL §5.25): the daemon analyzes the
   * workspace repository and returns an AI-assisted draft (not auto-saved).
   */
  async function generate() {
    isGenerating = true;
    error = null;
    generatedScript = null;

    try {
      const workspaceId = await resolveWorkspaceId();
      if (!isComponentMounted) return;
      if (!workspaceId) {
        error = 'No workspace found for this repository yet — create the workspace first, then generate a setup script.';
        isGenerating = false;
        return;
      }

      const setupScript = await appClient.setupScripts.generate(workspaceId);
      if (!isComponentMounted) return;
      if (!setupScript || !setupScript.script) {
        error = 'Failed to generate setup script';
        isGenerating = false;
        return;
      }

      generatedScript = {
        name: setupScript.projectType ? `${setupScript.projectType} setup` : 'Generated setup',
        description: setupScript.projectType
          ? `Setup script generated for a ${setupScript.projectType} project`
          : 'Setup script generated from repository analysis',
        content: setupScript.script,
      };
      isGenerating = false;
    } catch (err) {
      logger.error('Failed to generate setup script', err);
      if (!isComponentMounted) return;
      error = err instanceof Error ? err.message : 'Failed to generate setup script';
      isGenerating = false;
    }
  }

  function handleUseScript(script: { name: string; description: string; content: string }) {
    onScriptGenerated?.(script);
  }
</script>

<div class="flex flex-col bg-background border border-border rounded-lg overflow-hidden">
  <!-- Header -->
  <div class="flex items-center justify-between px-3 py-2 border-b border-border bg-muted/30">
    <div class="flex items-center gap-2">
      <AuggieAvatar size={20} {agentId} />
      <span class="text-sm font-medium">Setup Script Generator</span>
      {#if isGenerating}
        <div class="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
      {/if}
    </div>
    <div class="flex items-center gap-1">
      <Button variant="ghost-light" size="sm" onclick={onClose} class="h-7 w-7 p-0">
        <Fa icon={faTimes} />
      </Button>
    </div>
  </div>

  <!-- Content - contained scroll that won't affect parent -->
  <div class="p-4 max-h-60 overflow-y-auto overscroll-contain">
    {#if error}
      <div class="text-sm text-destructive-foreground bg-destructive/10 rounded-md p-3">
        {error}
      </div>
    {:else if isGenerating}
      <div class="flex items-center gap-2 text-subtle">
        <div
          class="w-4 h-4 border-2 border-muted-foreground/30 border-t-primary rounded-full animate-spin"
        ></div>
        <span class="text-sm">Analyzing repository...</span>
      </div>
    {/if}
  </div>

  <!-- Generated Script Preview -->
  {#if generatedScript && !isGenerating}
    <div class="border-t border-border p-3 bg-muted/30">
      <div class="flex items-center justify-between mb-2">
        <div class="flex items-center gap-2">
          <Fa icon={faCheck} class="text-green-500" />
          <span class="text-sm font-medium">{generatedScript.name}</span>
        </div>
        <Button
          variant="default"
          size="sm"
          onclick={() => handleUseScript(generatedScript!)}
          class="h-7"
        >
          Create Script
        </Button>
      </div>
      <p class="text-xs text-subtle mb-2">{generatedScript.description}</p>
      <div class="h-32 rounded border border-border overflow-hidden">
        <CodeEditor
          value={generatedScript.content}
          language="shell"
          readOnly={true}
          lineNumbers={false}
        />
      </div>
    </div>
  {/if}
</div>
