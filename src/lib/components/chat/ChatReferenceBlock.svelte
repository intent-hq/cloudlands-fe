<script lang="ts">
  import Fa from 'svelte-fa';
  import { faCode } from '@fortawesome/free-solid-svg-icons';
  import CodeBlock from '$lib/components/editor/CodeBlock.svelte';
  import { parseSemanticId } from '$shared/types/notes-primitives';
  import { m } from '$shared/paraglide/messages.js';

  interface ReferenceData {
    semanticId?: string;
    filePath?: string;
    description?: string;
    snapshot?: { code: string; filePath: string; languageId?: string };
  }

  interface Props {
    reference: ReferenceData;
    /** Callback for opening the referenced file. Includes openInAdjacentPanel and sourcePanelId for panel layout support. */
    onOpenFile?: (detail: {
      path: string;
      line?: number;
      openInAdjacentPanel?: boolean;
      sourcePanelId?: string;
    }) => void;
  }

  let { reference, onOpenFile }: Props = $props();

  const parsedId = $derived(reference.semanticId ? parseSemanticId(reference.semanticId) : null);
  // The filePath field may itself carry a trailing "#L<n>" / "#L<n>-<m>" line
  // anchor. Unlike semanticId, filePath is an unrestricted path, so interpret
  // ONLY the line anchor (same regex as parseSemanticId's line branch) — other
  // fragments like "#symbol:" or a literal "#" must pass through untouched so
  // real paths are not truncated.
  const parsedFilePath = $derived.by(() => {
    if (!reference.filePath) return null;
    const lineMatch = reference.filePath.match(/^(.+)#L(\d+)(?:-(\d+))?$/);
    if (!lineMatch) return null;
    const [, path, startLine] = lineMatch;
    return { filePath: path, startLine: parseInt(startLine, 10) };
  });
  const filePath = $derived(
    parsedFilePath?.filePath || reference.filePath || parsedId?.filePath || '',
  );
  const fileName = $derived(
    filePath.split('/').pop() || reference.semanticId || m.chat_messageContent_reference_fallback(),
  );
  // Line anchors are 1-based by convention, but ReferenceTargetSchema allows
  // 0-based ranges and getSemanticId() can derive "#L0" from them. Clamp to 1
  // so the jump target survives downstream truthy checks (e.g. FileTabType).
  // filePath wins over semanticId for the path, so its anchor wins for the line too.
  const startLine = $derived(parsedFilePath?.startLine ?? parsedId?.startLine);
  const line = $derived(startLine !== undefined ? Math.max(1, startLine) : undefined);
  const clickable = $derived(Boolean(filePath && onOpenFile));

  function handleClick(event: MouseEvent) {
    if (!filePath || !onOpenFile) return;
    const openInAdjacentPanel = event.metaKey || event.ctrlKey;
    const panelElement = (event.target as HTMLElement)?.closest('[data-panel-id]');
    const sourcePanelId = panelElement?.getAttribute('data-panel-id') ?? undefined;
    onOpenFile({ path: filePath, line, openInAdjacentPanel, sourcePanelId });
  }
</script>

<div class="my-2 rounded-lg border border-border overflow-hidden bg-background">
  {#if clickable}
    <button
      type="button"
      class="flex items-center gap-2 px-3 py-1.5 w-full text-left hover:bg-accent/50 transition-colors cursor-pointer"
      onclick={handleClick}
      title={m.notes_referenceBlock_goToFile_tooltip()}
    >
      <Fa icon={faCode} size="xs" class="flex-none text-ghost" />
      <span class="text-sm font-medium truncate">{fileName}</span>
      {#if filePath && filePath !== fileName}
        <span class="text-sm text-subtle truncate flex-1 min-w-0">
          {filePath}
        </span>
      {/if}
    </button>
  {:else}
    <div class="flex items-center gap-2 px-3 py-1.5">
      <Fa icon={faCode} size="xs" class="flex-none text-ghost" />
      <span class="text-sm font-medium truncate">{fileName}</span>
      {#if filePath && filePath !== fileName}
        <span class="text-sm text-subtle truncate flex-1 min-w-0">
          {filePath}
        </span>
      {/if}
    </div>
  {/if}
  {#if reference.snapshot?.code}
    <div class="border-t border-border">
      <CodeBlock
        code={reference.snapshot.code}
        language={reference.snapshot.languageId || 'plaintext'}
        showLineNumbers={true}
        noBorder={true}
        noMargin={true}
      />
    </div>
  {/if}
</div>
