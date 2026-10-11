// The seven source widgets are catalog-exempt. These callers exercise their real APIs;
// no source appearance scene or parity coverage is claimed by this module.
// i18n-ignore (internal catalog exercise content)
import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Portal } from '@/components/ui/portal';
import { RelativeTime } from '@/components/ui/relative-time';
import { AnimatedNumber } from '@/components/ui/animated-number';
import { EditableName } from '@/components/ui/editable-name';
import { GitHubAvatar } from '@/components/ui/github-avatar';
import { HoverCard } from '@/components/ui/hover-card';
import { VirtualList } from '@/components/ui/virtual-list';

function PortalExample() {
  const [target, setTarget] = useState<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(true);
  const [count, setCount] = useState(0);
  return (
    <>
      <Button onClick={() => setVisible((value) => !value)}>Toggle portal content</Button>
      <div ref={setTarget} data-testid="widget-portal-target" />
      {visible && target && (
        <Portal target={target}>
          <Button onClick={() => setCount((value) => value + 1)}>Portal action</Button>
        </Portal>
      )}
      <output aria-label="Portal actions">{count}</output>
    </>
  );
}
function TimeExample() {
  const [date, setDate] = useState<string | number>('2026-01-01T12:00:00Z');
  const [compact, setCompact] = useState(false);
  return (
    <>
      <RelativeTime date={date} compact={compact} />
      <Button onClick={() => setDate(Date.now())}>Use current time</Button>
      <Button onClick={() => setDate('invalid')}>Use invalid time</Button>
      <Switch aria-label="Compact timestamp" checked={compact} onCheckedChange={setCompact} />
    </>
  );
}
function NumberExample() {
  const [value, setValue] = useState(10);
  return (
    <>
      <AnimatedNumber value={value} />
      <Button onClick={() => setValue((n) => n + 10)}>Increase number</Button>
      <Button onClick={() => setValue((n) => n - 10)}>Decrease number</Button>
      <output aria-label="Number target">{value}</output>
    </>
  );
}
function NameExample() {
  const [value, setValue] = useState('Workspace name');
  const [count, setCount] = useState(0);
  const [disabled, setDisabled] = useState(false);
  return (
    <>
      <EditableName
        value={value}
        disabled={disabled}
        onSave={(next) => {
          setValue(next);
          setCount((n) => n + 1);
        }}
      />
      <Switch aria-label="Disable name editing" checked={disabled} onCheckedChange={setDisabled} />
      <Button
        onPointerDown={(event) => event.preventDefault()}
        onClick={() => setValue('External workspace name')}
      >
        Update external name
      </Button>
      <output aria-label="Saved editable name">{value}</output>
      <output aria-label="Name save count">{count}</output>
    </>
  );
}
const validAvatar = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><text x="4" y="24">A</text></svg>')}`;
function AvatarExample() {
  const [valid, setValid] = useState(false);
  const [identity, setIdentity] = useState('ada');
  return (
    <>
      <GitHubAvatar
        identity={identity}
        avatarUrl={valid ? validAvatar : 'data:image/png;base64,invalid'}
        alt="Example GitHub avatar"
        size={32}
        fallback={<span data-testid="github-avatar-fallback">Avatar unavailable</span>}
      />
      <Button onClick={() => setValid(true)}>Restore GitHub avatar</Button>
      <Button onClick={() => setValid(false)}>Break GitHub avatar</Button>
      <Button onClick={() => setIdentity((value) => (value === 'ada' ? 'grace' : 'ada'))}>
        Change avatar identity
      </Button>
      <output aria-label="GitHub avatar identity">{identity}</output>
    </>
  );
}
function HoverExample() {
  const id = useId();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(0);
  return (
    <>
      <Button
        ref={setAnchor}
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
      >
        Toggle hover surface
      </Button>
      <HoverCard
        id={id}
        anchor="--catalog-widget-anchor"
        anchorElement={anchor}
        position="bottom-right"
        open={open}
      >
        <div className="grid gap-2 p-4">
          <p>Additional workspace details</p>
          <Button onClick={() => setCount((n) => n + 1)}>Hover surface action</Button>
          <Button
            onClick={() => {
              setOpen(false);
              anchor?.focus();
            }}
          >
            Close hover surface
          </Button>
        </div>
      </HoverCard>
      <output aria-label="Hover surface actions">{count}</output>
    </>
  );
}
const virtualItems = Array.from({ length: 200 }, (_, index) => ({
  id: index + 1,
  label: `Widget item ${index + 1}`,
}));
function VirtualExample() {
  const [selected, setSelected] = useState(0);
  return (
    <>
      <VirtualList
        items={virtualItems}
        getKey={(item) => item.id}
        itemHeight={50}
        containerHeight={200}
      >
        {({ item, index }) => (
          <Button onClick={() => setSelected(item.id)} aria-label={`Choose ${item.label}`}>
            <span>{item.label}</span>
            <span className="sr-only">Index {index}</span>
          </Button>
        )}
      </VirtualList>
      <output aria-label="Virtual widget selection">{selected}</output>
    </>
  );
}
export function DisplayWidgetExample({ slug }: { slug: string }) {
  return (
    <section className="grid gap-4" data-functional-example={slug}>
      <p className="text-sm text-muted-foreground">
        Additional interaction example. This source widget has no reference catalog scene.
      </p>
      {slug === 'portal' && <PortalExample />}
      {slug === 'relative-time' && <TimeExample />}
      {slug === 'animated-number' && <NumberExample />}
      {slug === 'editable-name' && <NameExample />}
      {slug === 'github-avatar' && <AvatarExample />}
      {slug === 'hover-card' && <HoverExample />}
      {slug === 'virtual-list' && <VirtualExample />}
    </section>
  );
}
