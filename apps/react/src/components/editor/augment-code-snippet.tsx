import { Button } from '@/components/ui/button';
import { CodeBlock } from '@/components/editor/code-block';
import { m } from '$shared/paraglide/messages.js';

export interface AugmentCodeSnippetProps {
  code?: string;
  language?: string;
  path?: string;
  mode?: string;
  showLineNumbers?: boolean;
  /** Callback for opening a file. Includes panel layout placement. */
  onOpenFile?: (detail: {
    path: string;
    openInAdjacentPanel?: boolean;
    sourcePanelId?: string;
  }) => void;
}

export function AugmentCodeSnippet({
  code = '',
  language = 'plaintext',
  path = '',
  mode = 'EXCERPT',
  showLineNumbers = true,
  onOpenFile,
}: AugmentCodeSnippetProps) {
  function handleOpenFile(event: MouseEvent) {
    if (path) {
      const openInAdjacentPanel = event.metaKey || event.ctrlKey;
      const panelElement = (event.target as HTMLElement)?.closest('[data-panel-id]');
      const sourcePanelId = panelElement?.getAttribute('data-panel-id') ?? undefined;
      onOpenFile?.({ path, openInAdjacentPanel, sourcePanelId });
    }
  }

  const pathParts = path.split(':');
  const filePath = pathParts[0];
  const lineRange = pathParts[1] || '';

  return (
    <div className="my-4 group">
      <div className="flex items-center justify-between mb-1 px-3">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <Button
            className="flex items-center gap-1.5 flex-1 min-w-0 text-left hover:text-muted-foreground transition-colors text-inherit cursor-pointer"
            onClick={(event) => handleOpenFile(event.nativeEvent)}
            title={m.editor_codeSnippet_openFile_tooltip()}
          >
            <span className="text-muted-foreground truncate group-hover:text-muted-foreground transition-colors">
              {filePath.split('/').pop()}
            </span>
            {lineRange && <span className="text-subtle">:{lineRange}</span>}
          </Button>
        </div>

        {mode && mode !== 'EXCERPT' && (
          <span className="text-ui font-semibold text-muted-foreground bg-muted px-2 py-0.5 rounded">
            {mode}
          </span>
        )}
      </div>

      <CodeBlock
        code={code}
        language={language}
        fileName={filePath}
        showLineNumbers={showLineNumbers}
      />
    </div>
  );
}
