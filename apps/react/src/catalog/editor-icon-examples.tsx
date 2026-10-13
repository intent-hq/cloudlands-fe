// i18n-ignore (internal unreleased preview controls and brand names)
import { useState } from 'react';
import { TerminalIcon } from '@/components/icons/terminal-icon';
import { WarpIcon } from '@/components/icons/warp-icon';
import { CursorCodeIcon } from '@/components/icons/cursor-code-icon';
import { Button } from '@/components/ui/button';

const editors = [
  { name: 'Terminal', Icon: TerminalIcon },
  { name: 'Warp', Icon: WarpIcon },
  { name: 'Cursor', Icon: CursorCodeIcon },
];

export function EditorIconExamples() {
  const [selected, setSelected] = useState('Terminal');
  return (
    <section className="grid min-w-0 gap-6" data-testid="editor-icons-demo">
      <header>
        <h1>Editor icons</h1>
        <p className="type-caption text-muted-foreground">Internal React preview · unreleased</p>
      </header>
      <div className="flex flex-wrap gap-3" aria-label="Editor examples">
        {editors.map(({ name, Icon }) => (
          <Button
            key={name}
            variant="outline"
            aria-pressed={selected === name}
            onClick={() => setSelected(name)}
            leadingIcon={
              <span aria-hidden="true">
                <Icon />
              </span>
            }
          >
            {name}
          </Button>
        ))}
      </div>
      <output className="type-caption text-muted-foreground">Selected: {selected}</output>
    </section>
  );
}
