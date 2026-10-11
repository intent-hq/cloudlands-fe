// Source: src/lib/components/ui/sidebar/SidebarHarness.svelte; durable source-backed public preview.
// i18n-ignore (reference fixture labels; internal catalog, never product copy)
import { useState } from 'react';
import { m } from '$shared/paraglide/messages.js';
import { SidebarProvider, type SidebarPeek } from './context';
import { Sidebar, type SidebarProps } from './sidebar';
import {
  SidebarHeader,
  SidebarContent,
  SidebarFooter,
  SidebarInset,
  SidebarTrigger,
  SidebarCallout,
  SidebarMenuSkeleton,
} from './sidebar-layout';
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupActions,
  SidebarGroupAction,
  SidebarGroupContent,
} from './sidebar-group';
import { SidebarMenu } from './sidebar-menu';
import { SidebarMenuItem, SidebarMenuSub, SidebarMenuSubItem } from './sidebar-menu-row';
import { SidebarMenuButton, SidebarMenuSubButton } from './sidebar-menu-button';
import { SidebarMenuAction, SidebarMenuActions, SidebarMenuBadge } from './sidebar-menu-actions';

export interface SidebarHarnessProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  peek?: SidebarPeek;
  variant?: SidebarProps['variant'];
  rail?: boolean;
  side?: SidebarProps['side'];
  collapsible?: SidebarProps['collapsible'];
  insetAs?: 'main' | 'div';
  fixtureState?:
    | 'default'
    | 'floating'
    | 'inset'
    | 'nested'
    | 'actions-and-badges'
    | 'header-footer-stacking'
    | 'callouts'
    | 'status-dots'
    | 'skeleton'
    | 'compact'
    | 'collapsed'
    | 'peek-hover'
    | 'resizing';
}
export function SidebarHarness({
  open: controlled,
  onOpenChange,
  peek = 'none',
  variant = 'sidebar',
  rail = true,
  side = 'left',
  collapsible = 'offcanvas',
  fixtureState = 'default',
  insetAs = 'main',
}: SidebarHarnessProps) {
  const [open, setOpen] = useState(controlled ?? false);
  const [lastControlled, setLastControlled] = useState(controlled);
  if (lastControlled !== controlled) {
    setLastControlled(controlled);
    if (controlled !== undefined) setOpen(controlled);
  }
  const [selections, setSelections] = useState(0);
  const stacked = fixtureState === 'header-footer-stacking';
  return (
    <SidebarProvider
      open={open}
      onOpenChange={(value) => {
        setOpen(value);
        onOpenChange?.(value);
      }}
      peek={peek}
      persist={false}
      data-force-actions={fixtureState === 'actions-and-badges'}
      data-sidebar-fixture-state={fixtureState}
      className="relative h-72 !min-h-0 overflow-hidden rounded-md border border-border"
    >
      <Sidebar
        collapsible={collapsible}
        variant={variant}
        rail={rail}
        side={side}
        className="!absolute !inset-y-0 !h-full"
      >
        <SidebarHeader orientation={stacked ? 'horizontal' : 'vertical'}>
          <span className="type-title min-w-0 flex-1 truncate">Workspace</span>
          {stacked && <SidebarTrigger />}
        </SidebarHeader>
        <SidebarContent>
          {fixtureState === 'callouts' && (
            <div className="flex flex-col gap-2 p-2">
              <SidebarCallout>
                <strong className="type-body">New workspace tools</strong>
                <span className="type-caption text-muted-foreground">
                  Explore the updated navigation.
                </span>
              </SidebarCallout>
              <SidebarCallout variant="inline">
                <span className="type-caption">Three updates available</span>
              </SidebarCallout>
            </div>
          )}
          <SidebarGroup collapsible defaultOpen>
            <SidebarGroupLabel>Navigation</SidebarGroupLabel>
            {fixtureState === 'actions-and-badges' && (
              <SidebarGroupActions>
                <SidebarGroupAction aria-label="Add navigation item">
                  <span>+</span>
                </SidebarGroupAction>
                <SidebarGroupAction aria-label="Navigation options">
                  <span>⋯</span>
                </SidebarGroupAction>
              </SidebarGroupActions>
            )}
            <SidebarGroupContent>
              <SidebarMenu size={fixtureState === 'compact' ? 'compact' : undefined}>
                {fixtureState === 'skeleton' ? (
                  [0, 1, 2, 3].map((widthIndex) => (
                    <SidebarMenuSkeleton key={widthIndex} showIcon widthIndex={widthIndex} />
                  ))
                ) : (
                  <>
                    <SidebarMenuItem>
                      <SidebarMenuButton
                        aria-label="Overview"
                        label="Overview"
                        isActive={fixtureState !== 'nested' && fixtureState !== 'status-dots'}
                        status={fixtureState === 'status-dots' ? 'active' : undefined}
                        tooltipContent="Overview"
                        onClick={() => setSelections((value) => value + 1)}
                      />
                      {fixtureState === 'actions-and-badges' && (
                        <SidebarMenuAction showOnHover aria-label="Overview actions">
                          <span aria-hidden="true">⋯</span>
                        </SidebarMenuAction>
                      )}
                    </SidebarMenuItem>
                    <SidebarMenuItem>
                      <SidebarMenuButton
                        aria-label={
                          fixtureState === 'status-dots' ? undefined : 'Projects navigation'
                        }
                        label="Projects"
                        isActive={fixtureState === 'nested'}
                        status={fixtureState === 'status-dots' ? 'unread' : undefined}
                      />
                      {fixtureState === 'nested' && (
                        <SidebarMenuSub>
                          <SidebarMenuSubItem>
                            <SidebarMenuSubButton label="Roadmap" aria-label="Roadmap navigation" />
                          </SidebarMenuSubItem>
                          <SidebarMenuSubItem>
                            <SidebarMenuSubButton
                              label="Design"
                              aria-label="Design navigation"
                              isActive
                            />
                            <SidebarMenuSub>
                              <SidebarMenuSubItem>
                                <SidebarMenuSubButton
                                  label="Components"
                                  aria-label="Components navigation"
                                  isActive
                                />
                              </SidebarMenuSubItem>
                              <SidebarMenuSubItem>
                                <SidebarMenuSubButton
                                  label="Tokens"
                                  aria-label="Tokens navigation"
                                />
                              </SidebarMenuSubItem>
                            </SidebarMenuSub>
                          </SidebarMenuSubItem>
                        </SidebarMenuSub>
                      )}
                    </SidebarMenuItem>
                    <SidebarMenuItem>
                      <SidebarMenuButton
                        aria-label="Settings navigation"
                        label="Settings"
                        status={
                          fixtureState === 'status-dots'
                            ? 'idle'
                            : fixtureState === 'actions-and-badges'
                              ? 'unread'
                              : undefined
                        }
                      />
                      {fixtureState === 'actions-and-badges' && (
                        <>
                          <SidebarMenuBadge>3</SidebarMenuBadge>
                          <SidebarMenuActions showOnHover>
                            <SidebarMenuAction aria-label="Pin settings">
                              <span>+</span>
                            </SidebarMenuAction>
                            <SidebarMenuAction aria-label="Settings options">
                              <span>⋯</span>
                            </SidebarMenuAction>
                          </SidebarMenuActions>
                        </>
                      )}
                    </SidebarMenuItem>
                    <SidebarMenuItem>
                      <SidebarMenuButton
                        aria-label="Disabled navigation"
                        label="Disabled navigation"
                        disabled
                      />
                    </SidebarMenuItem>
                  </>
                )}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        {stacked && (
          <SidebarFooter orientation="horizontal">
            <span className="type-caption min-w-0 flex-1 truncate text-muted-foreground">
              Signed in
            </span>
            <SidebarTrigger />
          </SidebarFooter>
        )}
      </Sidebar>
      <SidebarInset as={insetAs} className="min-w-0 overflow-hidden p-6 pt-12">
        <SidebarTrigger className="absolute right-3 top-3" />
        <div className="max-w-md flex flex-col gap-2">
          <h2 className="type-title">{m.workspace_multiSelectSidebar_overviewTab_label()}</h2>
          <p className="type-body text-muted-foreground">
            {m.workspace_multiSelectSidebar_overviewTab_description()}
          </p>
          <p className="type-body text-muted-foreground">
            {m.workspace_multiSelectSidebar_contextTab_description()}
          </p>
        </div>
      </SidebarInset>
      <output className="sr-only" aria-label="Sidebar open state">
        {String(open)}
      </output>
      <output className="sr-only" aria-label="Sidebar menu selections">
        {selections}
      </output>
    </SidebarProvider>
  );
}
