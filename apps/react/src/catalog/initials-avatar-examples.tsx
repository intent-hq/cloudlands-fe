// i18n-ignore (internal unreleased component preview controls)
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import InitialsAvatar from '@/components/tiptap/comments/initials-avatar';

export function InitialsAvatarExamples() {
  const [name, setName] = useState('Ada Lovelace');
  const [size, setSize] = useState('32');
  const [visible, setVisible] = useState(true);
  const [actions, setActions] = useState(0);

  return (
    <section className="grid min-w-0 w-full max-w-lg gap-4" data-testid="initials-avatar-demo">
      <header>
        <h2>Comment initials</h2>
        <p className="type-caption text-muted-foreground">Internal React preview · unreleased</p>
      </header>
      <Input
        aria-label="Avatar size preview"
        value={size}
        onChange={(event) => setSize(event.currentTarget.value)}
      />
      <Button variant="outline" aria-pressed={visible} onClick={() => setVisible(!visible)}>
        Show initials
      </Button>
      <Input
        aria-label="Comment author preview"
        value={name}
        onChange={(event) => setName(event.currentTarget.value)}
      />
      <div className="min-w-0 p-3" data-testid="initials-avatar-frame">
        {visible && <InitialsAvatar name={name} size={Number(size)} />}
      </div>
      <Button variant="outline" onClick={() => setActions((previous) => previous + 1)}>
        After initials
      </Button>
      <output aria-label="After initials activations">{actions}</output>
    </section>
  );
}
