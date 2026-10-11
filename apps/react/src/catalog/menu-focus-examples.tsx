// Internal native focus exercise. Production primitives own every focus transition.
// i18n-ignore (internal catalog controls and fixed option labels)
import { useState } from 'react';
import * as Menu from '@/components/ui/menu';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { ContentDialog } from '@/components/patterns/confirm';
import { Popover, PopoverTrigger, PopoverContent, PopoverClose } from '@/components/ui/popover';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
  SelectItem,
} from '@/components/ui/select';
import { Combobox } from '@/components/ui/combobox';
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetTitle,
  SheetDescription,
  SheetClose,
} from '@/components/ui/sheet';
import { CatalogLink } from './catalog-link';

function StaticMenuExample({
  forceMount,
  onUnmount,
}: {
  forceMount: boolean;
  onUnmount: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(true);
  const [commands, setCommands] = useState<string[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogActions, setDialogActions] = useState(0);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [selected, setSelected] = useState('alpha');
  const [comboValue, setComboValue] = useState<string | string[]>('alpha');

  return (
    <div className="grid gap-3" data-testid="static-menu-host">
      <Menu.Root staticPosition defaultOpen onOpenChange={setMenuOpen}>
        <Menu.Trigger asChild>
          <Button data-testid="static-menu-trigger">Toggle static menu</Button>
        </Menu.Trigger>
        <Menu.Content
          aria-label="Static focus menu"
          data-testid="static-focus-menu"
          forceMount={forceMount ? true : undefined}
        >
          <Menu.Group>
            <Menu.Item
              closeOnSelect={false}
              onSelect={() => setCommands((values) => [...values, 'first'])}
            >
              First command
            </Menu.Item>
            <Menu.Sub>
              <Menu.SubTrigger>More focus actions</Menu.SubTrigger>
              <Menu.SubContent aria-label="Nested focus menu" data-testid="nested-focus-menu">
                <Menu.Group>
                  <Menu.Item
                    closeOnSelect={false}
                    onSelect={() => setCommands((values) => [...values, 'submenu'])}
                  >
                    Submenu command
                  </Menu.Item>
                  <Menu.Item
                    closeOnSelect={false}
                    onSelect={() => setCommands((values) => [...values, 'second-submenu'])}
                  >
                    Second submenu command
                  </Menu.Item>
                </Menu.Group>
              </Menu.SubContent>
            </Menu.Sub>
            <Menu.Item closeOnSelect={false} onSelect={() => setDialogOpen(true)}>
              Open nested dialog
            </Menu.Item>
            <Popover onOpenChange={setPopoverOpen}>
              <PopoverTrigger asChild>
                <Menu.Item closeOnSelect={false}>Open nested popover</Menu.Item>
              </PopoverTrigger>
              <PopoverContent aria-label="Nested focus popover" className="grid gap-3">
                <Input aria-label="Nested popover field" />
                <PopoverClose asChild>
                  <Button>Close nested popover</Button>
                </PopoverClose>
              </PopoverContent>
            </Popover>
            <Sheet onOpenChange={setSheetOpen}>
              <SheetTrigger asChild>
                <Menu.Item closeOnSelect={false}>Open nested sheet</Menu.Item>
              </SheetTrigger>
              <SheetContent closeLabel="Close nested sheet">
                <SheetTitle>Nested focus sheet</SheetTitle>
                <SheetDescription>
                  Use the native field and dismiss to return to the menu.
                </SheetDescription>
                <Input aria-label="Nested sheet field" />
                <SheetClose asChild>
                  <Button>Dismiss nested sheet</Button>
                </SheetClose>
              </SheetContent>
            </Sheet>
            <Menu.Item closeOnSelect={false} onSelect={onUnmount}>
              Unmount active menu
            </Menu.Item>
            <Menu.Item onSelect={() => setCommands((values) => [...values, 'close'])}>
              Close with command
            </Menu.Item>
          </Menu.Group>
          <div className="grid gap-3 p-2">
            <Input aria-label="Parent menu field" />
            <Select value={selected} onValueChange={setSelected}>
              <SelectTrigger aria-label="Nested select">
                <SelectValue />
              </SelectTrigger>
              <SelectContent portal aria-label="Nested select options">
                <SelectGroup>
                  <SelectItem value="alpha">Alpha</SelectItem>
                  <SelectItem value="beta">Beta</SelectItem>
                  <SelectItem value="gamma">Gamma</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
            <Combobox
              ariaLabel="Nested combobox"
              value={comboValue}
              onChange={setComboValue}
              options={[
                { value: 'alpha', label: 'Alpha' },
                { value: 'beta', label: 'Beta' },
                { value: 'gamma', label: 'Gamma' },
              ]}
            />
          </div>
          <ContentDialog
            open={dialogOpen}
            onOpenChange={setDialogOpen}
            title="Nested focus dialog"
            description="Use the native field and dismiss to return to the menu."
            closeLabel="Close nested dialog"
          >
            <Input aria-label="Nested dialog field" />
            <Button onClick={() => setDialogActions((count) => count + 1)}>
              Nested dialog action
            </Button>
            <Button onClick={() => setDialogOpen(false)}>Dismiss nested dialog</Button>
            <output aria-label="Nested dialog actions">{dialogActions}</output>
          </ContentDialog>
        </Menu.Content>
      </Menu.Root>
      <output aria-label="Static menu open" data-testid="static-menu-open">
        {String(menuOpen)}
      </output>
      <output aria-label="Menu commands" data-testid="menu-focus-commands">
        {JSON.stringify(commands)}
      </output>
      <output aria-label="Nested dialog open">{String(dialogOpen)}</output>
      <output aria-label="Nested popover open">{String(popoverOpen)}</output>
      <output aria-label="Nested sheet open">{String(sheetOpen)}</output>
      <output aria-label="Nested select value">{selected}</output>
      <output aria-label="Nested combobox value">{JSON.stringify(comboValue)}</output>
    </div>
  );
}

export function MenuFocusExamples() {
  const [mounted, setMounted] = useState(false);
  const [forceMount, setForceMount] = useState(false);
  const [outsideClicks, setOutsideClicks] = useState(0);
  return (
    <section
      className="grid gap-4"
      data-functional-example="menu-focus"
      aria-label="Menu focus ownership exercise"
    >
      <h1>Menu focus ownership</h1>
      <p>
        Mount the real static menu open, then use its nested overlays or close and unmount it. The
        controls supply host props; the menu and overlays own focus. Native behavior acceptance
        remains pending.
      </p>
      <CatalogLink href="/sandbox/menu">Menu source fixtures</CatalogLink>
      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={mounted} onClick={() => setMounted(true)} data-testid="mount-static-menu">
          Mount static menu
        </Button>
        <Button
          disabled={!mounted}
          onClick={() => setMounted(false)}
          data-testid="unmount-static-menu"
        >
          Unmount static menu
        </Button>
        <Label className="flex items-center gap-2">
          <Switch
            aria-label="Force mount menu content"
            checked={forceMount}
            onCheckedChange={setForceMount}
          />
          Force mount menu content
        </Label>
      </div>
      <Button
        onClick={() => setOutsideClicks((count) => count + 1)}
        data-testid="menu-focus-outside"
      >
        Outside action
      </Button>
      <Input aria-label="Outside field" />
      <output aria-label="Outside action count" data-testid="menu-focus-outside-count">
        {outsideClicks}
      </output>
      <output aria-label="Menu mounted">{String(mounted)}</output>
      {mounted && <StaticMenuExample forceMount={forceMount} onUnmount={() => setMounted(false)} />}
    </section>
  );
}
