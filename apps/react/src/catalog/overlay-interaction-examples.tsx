// Additional real-interaction callers; these are not source appearance fixtures.
// i18n-ignore (internal catalog exercise content)
import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Toggle } from '@/components/ui/toggle';
import { Switch } from '@/components/ui/switch';
import { TooltipRich } from '@/components/ui/tooltip-rich';
import { Tooltip, TooltipShortcut } from '@/components/ui/tooltip';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export function PublicTooltipExample() {
  const descriptionId = useId();
  const portalId = useId();
  const [target, setTarget] = useState<HTMLDivElement | null>(null);
  const [selectorTarget, setSelectorTarget] = useState(false);
  const [open, setOpen] = useState(false);
  const [disabled, setDisabled] = useState(false);
  const [keepOpen, setKeepOpen] = useState(false);
  const [pressed, setPressed] = useState(false);
  const [childClicks, setChildClicks] = useState(0);
  const [wrapperClicks, setWrapperClicks] = useState(0);
  return (
    <section
      className="grid gap-4"
      data-functional-example="tooltip-public"
      aria-label="Public tooltip forwarding"
    >
      <h2>Public tooltip forwarding</h2>
      <p id={descriptionId}>The original public control description remains available.</p>
      <div id={portalId} ref={setTarget} data-testid="public-tooltip-portal" />
      {target && (
        <Tooltip
          content="Wrapped button help"
          open={open}
          onOpenChange={setOpen}
          disabled={disabled}
          disableCloseOnTriggerClick={keepOpen}
          portalTarget={selectorTarget ? `[id="${portalId}"]` : target}
          onClick={() => setWrapperClicks((value) => value + 1)}
        >
          <Toggle
            aria-label="Public tooltip control"
            aria-describedby={descriptionId}
            pressed={pressed}
            onPressedChange={setPressed}
            onClick={() => setChildClicks((value) => value + 1)}
          >
            Wrapped help
          </Toggle>
        </Tooltip>
      )}
      <Switch
        aria-label="Disable public tooltip"
        checked={disabled}
        onCheckedChange={setDisabled}
      />
      <Switch
        aria-label="Keep public tooltip open on click"
        checked={keepOpen}
        onCheckedChange={setKeepOpen}
      />
      <Switch
        aria-label="Use selector tooltip target"
        checked={selectorTarget}
        onCheckedChange={setSelectorTarget}
      />
      <Button onClick={() => setOpen(true)}>Open public tooltip</Button>
      <TooltipShortcut
        label="Open navigation"
        shortcut="mod+k"
        delayDuration={0}
        trigger={
          <Button aria-label="Alternate shortcut trigger" variant="ghost">
            Shortcut help
          </Button>
        }
      />
      <output aria-label="Public tooltip open">{String(open)}</output>
      <output aria-label="Public tooltip pressed">{String(pressed)}</output>
      <output aria-label="Public tooltip child clicks">{childClicks}</output>
      <output aria-label="Public tooltip wrapper clicks">{wrapperClicks}</output>
    </section>
  );
}

export function RichTooltipExample() {
  const descriptionId = useId();
  const [open, setOpen] = useState(false);
  const [disabled, setDisabled] = useState(false);
  const [keepOpen, setKeepOpen] = useState(false);
  const [pressed, setPressed] = useState(false);
  const [replacement, setReplacement] = useState(false);
  const [clicks, setClicks] = useState(0);
  const [closes, setCloses] = useState(0);
  const [actions, setActions] = useState(0);
  return (
    <section
      className="grid gap-4"
      data-functional-example="tooltip-forwarding"
      aria-label="Rich tooltip forwarding"
    >
      <h2>Rich tooltip forwarding</h2>
      <p id={descriptionId}>The original control description remains available.</p>
      <TooltipRich
        title="Rich button help"
        description="Additional help for the real control."
        open={open}
        onOpenChange={setOpen}
        disabled={disabled}
        interactive
        showClose
        disableCloseOnTriggerClick={keepOpen}
        onClick={() => setClicks((n) => n + 1)}
        onClose={() => {
          setCloses((n) => n + 1);
          setOpen(false);
        }}
        footer={<Button onClick={() => setActions((n) => n + 1)}>Tooltip action</Button>}
      >
        {replacement ? (
          <Button
            key="replacement"
            aria-label="Replacement tooltip control"
            aria-describedby={descriptionId}
          >
            Replacement control
          </Button>
        ) : (
          <Toggle
            key="toggle"
            aria-label="Rich tooltip control"
            aria-describedby={descriptionId}
            pressed={pressed}
            onPressedChange={setPressed}
          >
            Rich help
          </Toggle>
        )}
      </TooltipRich>
      <Switch aria-label="Disable rich tooltip" checked={disabled} onCheckedChange={setDisabled} />
      <Switch
        aria-label="Keep tooltip open on click"
        checked={keepOpen}
        onCheckedChange={setKeepOpen}
      />
      <Button onClick={() => setReplacement((value) => !value)}>Replace tooltip control</Button>
      <Button onClick={() => setOpen(true)}>Open rich tooltip</Button>
      <output aria-label="Rich tooltip open">{String(open)}</output>
      <output aria-label="Rich tooltip pressed">{String(pressed)}</output>
      <output aria-label="Rich tooltip clicks">{clicks}</output>
      <output aria-label="Rich tooltip closes">{closes}</output>
      <output aria-label="Rich tooltip actions">{actions}</output>
    </section>
  );
}

const fruits = [
  { value: 'apple', label: 'Apple' },
  { value: 'banana', label: 'Banana' },
];
export function SelectWrapperExample() {
  const wrapperId = `${useId()}-select-wrapper`;
  const content = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('apple');
  const [portal, setPortal] = useState(true);
  const [lookup, setLookup] = useState('missing');
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const wrapper = document.getElementById(wrapperId);
      setLookup(
        wrapper &&
          content.current &&
          wrapper !== content.current &&
          wrapper.contains(content.current)
          ? 'contains content'
          : 'missing',
      );
    });
    return () => cancelAnimationFrame(frame);
  }, [open, portal, wrapperId]);
  return (
    <section
      className="grid max-w-md gap-4"
      data-functional-example="select-wrapper"
      aria-label="Select wrapper lookup"
    >
      <h2>Select wrapper lookup</h2>
      <Switch aria-label="Portal select popup" checked={portal} onCheckedChange={setPortal} />
      <Select
        items={fruits}
        value={value}
        onValueChange={setValue}
        open={open}
        onOpenChange={setOpen}
      >
        <SelectTrigger aria-label="Wrapper lookup select">
          <SelectValue />
        </SelectTrigger>
        <SelectContent ref={content} wrapperId={wrapperId} portal={portal}>
          <SelectGroup>
            {fruits.map((fruit) => (
              <SelectItem key={fruit.value} value={fruit.value} label={fruit.label}>
                {fruit.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      <output aria-label="Select wrapper ID">{wrapperId}</output>
      <output aria-label="Select wrapper lookup">{lookup}</output>
      <output aria-label="Wrapper select value">{value}</output>
    </section>
  );
}

// Exact non-product cases from TooltipSurfaceHarness.svelte.
export function RichTooltipSurfacePreview({
  variant,
}: {
  variant: 'default' | 'info' | 'success' | 'warning' | 'error';
}) {
  return (
    <section className="m-8 w-80 bg-background p-4 text-foreground">
      <h2 className="type-heading">Finance Team</h2>
      <TooltipRich
        title="Browser connection status"
        description="Reconnect the shared workstation to continue using browser tabs."
        variant={variant}
        side="bottom"
        align="start"
      >
        <span>Browser status</span>
      </TooltipRich>
      <div data-testid="underlying-status" className="relative z-10 mt-2 type-body">
        <p className="bg-foreground text-background">Finance Team status</p>
        <p>Preparing the quarterly report and reconciling outstanding invoices.</p>
        <p>Waiting for the shared workstation to reconnect.</p>
      </div>
    </section>
  );
}
