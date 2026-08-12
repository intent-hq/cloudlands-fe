<script lang="ts">
  import Fa from 'svelte-fa';
  import { faArrowRight, faCode } from '@fortawesome/free-solid-svg-icons';
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

<div
  class="ws-block-widget type-body my-2 overflow-hidden rounded-md border border-border bg-card text-foreground shadow-(--elevation-raised)"
>
  {#if clickable}
    <button
      type="button"
      class="group flex min-h-9 w-full items-center gap-2 px-3 py-1.5 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-inset"
      onclick={handleClick}
      title={m.notes_referenceBlock_goToFile_tooltip()}
    >
      <Fa icon={faCode} size="xs" class="shrink-0 text-muted-foreground" />
      <span class="type-body truncate font-medium">{fileName}</span>
      {#if filePath && filePath !== fileName}
        <span class="type-caption min-w-0 flex-1 truncate text-muted-foreground">
          {filePath}
        </span>
      {/if}
      <Fa
        icon={faArrowRight}
        size="xs"
        class="shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground motion-reduce:transition-none"
      />
    </button>
  {:else}
    <div class="flex min-h-9 items-center gap-2 px-3 py-1.5">
      <Fa icon={faCode} size="xs" class="shrink-0 text-muted-foreground" />
      <span class="type-body truncate font-medium">{fileName}</span>
      {#if filePath && filePath !== fileName}
        <span class="type-caption min-w-0 flex-1 truncate text-muted-foreground">
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
