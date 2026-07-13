<script lang="ts">
  import { NodeViewWrapper } from 'svelte-tiptap';
  import type { NodeViewProps } from '@tiptap/core';
  import type { PatchPrimitive } from '$shared/types/notes-primitives';
  import { invoke } from '$lib/electron-bridge';
  import { toast } from 'svelte-sonner';
  import { createLogger } from '$lib/utils/client-logger';
  import { PatchBlockContent } from '$lib/components/ui/diff';

  const logger = createLogger('PatchBlock');

  // TipTap NodeViewProps
  let { node, updateAttributes, extension }: NodeViewProps = $props();

  // Get primitive data from node
  let primitive = $derived(node?.attrs?.data as PatchPrimitive);

  // Component state
  let applying = $state(false);

  // Get workspaceId from extension options
  let workspaceId = $derived(extension?.options?.workspaceId as string | undefined);

  // Apply all patches
  async function applyPatches() {
    if (!primitive || !primitive.patches || applying) return;
    if (!workspaceId) {
      toast.error('No space context available');
      return;
    }

    applying = true;
    let allSuccess = true;
    let errorMessage = '';

    try {
      for (const patch of primitive.patches) {
        const result = (await invoke('patch:apply', {
          workspaceId,
          filePath: patch.filePath,
          diff: patch.diff,
          createBackup: true,
        })) as any;

        if (!result.ok) {
          allSuccess = false;
          errorMessage = result.error;
          break;
        }
      }

      if (allSuccess) {
        if (updateAttributes) {
          updateAttributes({
            data: {
              ...primitive,
              lastApply: {
                status: 'success',
                appliedAt: new Date().toISOString(),
              },
            },
          });
        }

        toast.success('All patches applied successfully', {
          action: {
            label: 'Undo',
            onClick: () => revertPatches(),
          },
        });
      } else {
        if (updateAttributes) {
          updateAttributes({
            data: {
              ...primitive,
              lastApply: {
                status: 'error',
                appliedAt: new Date().toISOString(),
                errorMessage,
              },
            },
          });
        }

        toast.error(errorMessage);
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to apply patches';
      logger.error('[applyPatches] Error applying patches', { error: err, workspaceId });
      if (updateAttributes) {
        updateAttributes({
          data: {
            ...primitive,
            lastApply: {
              status: 'error',
              appliedAt: new Date().toISOString(),
              errorMessage: errorMsg,
            },
          },
        });
      }
      toast.error(errorMsg);
    } finally {
      applying = false;
    }
  }

  // Revert patches
  async function revertPatches() {
    if (!primitive || primitive.lastApply?.status !== 'success') return;
    if (!workspaceId) {
      toast.error('No space context available');
      return;
    }

    try {
      for (let i = primitive.patches.length - 1; i >= 0; i--) {
        const patch = primitive.patches[i];
        const result = (await invoke('patch:revert', {
          workspaceId,
          filePath: patch.filePath,
        })) as any;

        if (!result.ok) {
          toast.error(`Failed to revert patch for ${patch.filePath}: ${result.error}`);
          return;
        }
      }

      if (updateAttributes) {
        updateAttributes({
          data: {
            ...primitive,
            lastApply: undefined,
          },
        });
      }

      toast.success('All patches reverted successfully');
    } catch (err) {
      logger.error('[revertPatches] Error reverting patches', { error: err, workspaceId });
      toast.error(err instanceof Error ? err.message : 'Failed to revert patches');
    }
  }
</script>

<NodeViewWrapper>
  <PatchBlockContent
    patches={primitive?.patches ?? []}
    label={primitive?.label || 'Patch'}
    lastApply={primitive?.lastApply}
    linkedAgentId={primitive?.createdByAgentId}
    {applying}
    onApply={applyPatches}
    onRevert={revertPatches}
  />
</NodeViewWrapper>
