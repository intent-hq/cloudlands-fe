// i18n-ignore (internal unreleased preview controls and brand names)
import { useState } from 'react';
import { resolveEditorIcon, resolveEditorFallbackIcon } from '@/components/icons/editor-icon';
import { IconDefinitionIcon } from '@/components/icons/icon-definition';
import { EDITOR_REGISTRY } from '$shared/editors/editor-registry';
import { Button } from '@/components/ui/button';

const editors = [
  'terminal',
  'warp',
  'cursor',
  'vscode',
  'intellij',
  'ghostty',
  'xcode',
  'finder',
  'zed',
  'iterm',
].flatMap((id) => EDITOR_REGISTRY.filter((editor) => editor.id === id));

export function EditorIconExamples() {
  const [selected, setSelected] = useState('Terminal');
  return (
    <section
      className="grid w-lg min-w-0 max-w-[calc(100vw-var(--spacing)*12)] gap-6"
      data-testid="editor-icons-demo"
    >
      <header>
        <h1>Editor icons</h1>
        <p className="type-caption text-muted-foreground">Internal React preview · unreleased</p>
      </header>
      <div className="flex flex-wrap gap-3" aria-label="Editor examples">
        {editors.map((editor) => {
          const Icon = resolveEditorIcon(editor);
          return (
            <Button
              key={editor.id}
              variant="outline"
              aria-pressed={selected === editor.shortLabel}
              onClick={() => setSelected(editor.shortLabel)}
              leadingIcon={
                <span aria-hidden="true">
                  {Icon ? (
                    <Icon />
                  ) : (
                    <IconDefinitionIcon icon={resolveEditorFallbackIcon(editor.category)} />
                  )}
                </span>
              }
            >
              {editor.shortLabel}
            </Button>
          );
        })}
      </div>
      <output className="type-caption text-muted-foreground">Selected: {selected}</output>
    </section>
  );
}
