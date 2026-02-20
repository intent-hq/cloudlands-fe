<script lang="ts">
  /**
   * Background Agent Trigger Button
   *
   * A button component that triggers background agents for specific tasks.
   * Can be placed in various UI locations like git panels, file editors, etc.
   */

  import {
    faRobot,
    faSpinner,
    faCheck,
    faExclamationTriangle,
  } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import Button from '$lib/components/ui/button/button.svelte';
  import { agentFactory } from '$features/agent/services/agent-factory';
  import { workspaceStore } from '$features/workspace/workspace.store.svelte';
  import { gitStore } from '$features/git/git.store.svelte';
  import { backgroundAgentSettingsStore, type BackgroundAgentType } from '$lib/stores/background-agent-settings.store.svelte';
  import { WorkspaceId } from '$shared/types/branded-ids';
  import { assertAgentTypeId } from '$shared/types/agent.types';
  import { toast } from 'svelte-sonner';
  import { cn } from '$lib/utils';
  import { invoke } from '$lib/electron-bridge';
  import { onDestroy } from 'svelte';
  import type { FileStatus } from '$shared/types';

  type TriggerType = 'commit' | 'pr' | 'review';

  type ReviewContext = {
    files?: string[];
  };

  interface Props {
    type: TriggerType;
    label?: string;
    variant?: 'default' | 'ghost' | 'outline' | 'secondary';
    size?: 'xs' | 'sm' | 'md' | 'lg';
    className?: string;
    context?: ReviewContext; // Additional context to pass to the agent
    onSuccess?: (agentId: string) => void;
    onError?: (error: Error) => void;
  }

  let {
    type,
    label,
    variant = 'ghost',
    size = 'sm',
    className = '',
    context,
    onSuccess,
    onError,
  }: Props = $props();

  let isTriggering = $state(false);
  let status = $state<'idle' | 'running' | 'success' | 'error'>('idle');
  let resetTimer: ReturnType<typeof setTimeout> | null = null;

  // Get the label based on type if not provided
  let displayLabel = $derived(
    label ||
      (type === 'commit'
        ? 'Generate Commit Message'
        : type === 'pr'
          ? 'Generate PR Description'
          : 'Review Code'),
  );

  // Get icon based on status
  let icon = $derived(
    status === 'running'
      ? faSpinner
      : status === 'success'
        ? faCheck
        : status === 'error'
          ? faExclamationTriangle
          : faRobot,
  );

  async function prepareContext(
    workspace: { id: string; path: string },
    trigger: TriggerType,
  ): Promise<string> {
    try {
      // Load git status first - this updates the store's internal state
      await gitStore.loadStatus(WorkspaceId(workspace.id), true);
      const gitStatus = gitStore.status;

      if (trigger === 'commit') {
        // Get staged files from git status
        const stagedFiles = gitStatus?.files.filter((f: FileStatus) => f.staged) ?? [];

        if (stagedFiles.length === 0) {
          return 'No files are staged for commit. Please stage some files first.';
        }

        // Get diff for staged files
        const diffs = await Promise.all(
          stagedFiles.map(async (file: FileStatus) => {
            const diff = (await invoke('git:diff', {
              workspaceId: workspace.id,
              path: file.path,
              staged: true,
            })) as string;
            return { path: file.path, diff };
          }),
        );

        // Build context message
        let message = 'Generate a commit message for the following staged changes:\n\n';
        message += `Files changed (${stagedFiles.length}):\n`;

        stagedFiles.forEach((file: FileStatus) => {
          message += `- ${file.path} (${file.status})\n`;
        });

        message += '\n## Diffs:\n\n';
        diffs.forEach(({ path, diff }) => {
          message += `### ${path}\n\`\`\`diff\n${diff}\n\`\`\`\n\n`;
        });

        return message;
      } else if (trigger === 'pr') {
        // Get commits and changed files for PR
        const commits = (await invoke('git:log', {
          workspaceId: workspace.id,
          limit: 20,
        })) as { message?: string; sha?: string }[] | null;

        let message = 'Generate a pull request description for the following changes:\n\n';

        if (commits && commits.length > 0) {
          message += `## Commits (${commits.length}):\n`;
          commits.forEach((commit) => {
            const sha = commit.sha ?? '';
            // Fix: wrap the coalesce/logical expression properly
            const commitDisplay = commit.message ?? sha.slice(0, 7);
            message += `- ${commitDisplay}${sha ? ` (${sha.slice(0, 7)})` : ''}\n`;
          });
        }

        // Get all changed files (staged and unstaged)
        const changedFiles = gitStatus?.files ?? [];
        if (changedFiles.length > 0) {
          message += `\n## Files Changed (${changedFiles.length}):\n`;
          changedFiles.forEach((file: FileStatus) => {
            message += `- ${file.path}\n`;
          });
        }

        return message;
      } else if (trigger === 'review') {
        // Review staged changes or specific files
        if (context?.files && Array.isArray(context.files)) {
          let message = 'Please review the following code changes:\n\n';

          for (const file of context.files) {
            const content = (await invoke('fs:read', {
              path: `${workspace.path}/${file}`,
            })) as string;

            message += `## ${file}\n\`\`\`\n${content}\n\`\`\`\n\n`;
          }

          return message;
        }

        // Default to reviewing staged changes
        return prepareContext(workspace, 'commit');
      }

      return 'Please analyze the current context and provide assistance.';
    } catch (error) {
      return 'Failed to load context. Please check your repository.';
    }
  }

  async function triggerAgent() {
    if (isTriggering) return;

    const workspace = workspaceStore.current;
    if (!workspace) {
      toast.error('No space selected');
      return;
    }

    isTriggering = true;
    status = 'running';

    try {
      // Determine the agent type based on trigger type
      const triggerToAgentType: Record<TriggerType, ReturnType<typeof assertAgentTypeId>> = {
        commit: assertAgentTypeId('commit-message'),
        pr: assertAgentTypeId('pr-description'),
        review: assertAgentTypeId('code-review'),
      };
      const agentType = triggerToAgentType[type];

      // Prepare the initial context message before creating the agent
      // workspace.path can be undefined for some workspace types
      const contextMessage = await prepareContext(
        {
          id: workspace.id,
          path: workspace.path ?? '',
        },
        type,
      );

      // Create the background agent using agentFactory with agentType
      // Backend will build system prompt from agentType via InstructionService
      // Use background agent settings for model selection (supports per-type overrides)
      const result = await agentFactory.createAgent(workspace, {
        name: `${displayLabel} Agent`,
        workspaceId: WorkspaceId(workspace.id),
        model: backgroundAgentSettingsStore.getModelForType(type as BackgroundAgentType),
        agentType, // Backend loads instructions + user rules via 3-tier fallback
        initialMessage: contextMessage, // Include context as initial message
        metadata: {
          isBackground: true,
          triggerType: type,
          source: 'background-agent-trigger',
        },
        source: 'background-agent-trigger',
      });

      if (!result.success || !result.agent) {
        throw new Error(result.error || 'Failed to create agent');
      }

      const agent = result.agent;

      status = 'success';
      toast.success(`${displayLabel} agent started`);
      onSuccess?.(agent.id);

      if (resetTimer) clearTimeout(resetTimer);
      resetTimer = setTimeout(() => {
        status = 'idle';
        resetTimer = null;
      }, 2000);
    } catch (error) {
      status = 'error';
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      toast.error(`Failed to start agent: ${errorMessage}`);
      onError?.(error instanceof Error ? error : new Error(errorMessage));

      // Reset status after a delay
      if (resetTimer) clearTimeout(resetTimer);
      resetTimer = setTimeout(() => {
        status = 'idle';
        resetTimer = null;
      }, 3000);
    } finally {
      isTriggering = false;
    }
  }

  onDestroy(() => {
    if (resetTimer) {
      clearTimeout(resetTimer);
      resetTimer = null;
    }
  });
</script>

<Button
  {variant}
  {size}
  onclick={triggerAgent}
  disabled={isTriggering}
  class={cn(
    'gap-2 transition-all duration-200',
    status === 'success' && 'text-green-500',
    status === 'error' && 'text-red-500',
    className,
  )}
  title={displayLabel}
>
  <Fa {icon} size="sm" class={status === 'running' ? 'animate-spin' : ''} />
  <span>{displayLabel}</span>
</Button>
