// Source display/editing fixtures; no workspace or transport substitutes.
// i18n-ignore (internal source fixture content)
import { useLayoutEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { Button } from '@/components/ui/button';
import { EditableName } from '@/components/ui/editable-name';
import { AgentBadge, UnsavedIndicator } from '@/components/ui/indicators';
import { PanelWrapper } from '@/components/ui/panel-wrapper';
import { ContentHeader } from '@/features/layout/components/content-header';
import { GitHubLinkCardDisplayPreview } from '@/components/ui/github-link-card/display-preview';
import {
  githubLinkCardDisplayStates,
  type GitHubLinkCardDisplayState,
} from '@/components/ui/github-link-card/display-states';
import { cn } from '@/lib/utils';

export const githubLinkCardStates = Object.keys(
  githubLinkCardDisplayStates,
) as GitHubLinkCardDisplayState[];
export function GitHubLinkCardPreview({ state }: { state: string }) {
  if (!githubLinkCardStates.some((name) => name === state)) return null;
  return (
    <div
      data-catalog-coverage="display-only"
      data-catalog-gap="link-tooltip transport cache actions"
    >
      <GitHubLinkCardDisplayPreview state={state as GitHubLinkCardDisplayState} />
    </div>
  );
}

type TextCase = {
  id: string;
  label: string;
  value: string;
  disabled?: boolean;
  editable?: boolean;
  editValue?: string;
};
const normalCases: TextCase[] = [
  { id: 'normal', label: 'normal title', value: 'Preview implementation plan' },
];
const edgeCases: TextCase[] = [
  { id: 'empty', label: 'empty / placeholder', value: '', editValue: '' },
  { id: 'single', label: 'single character', value: 'A' },
  {
    id: 'long',
    label: 'very long title',
    value: 'A very long editable title that exceeds its maximum width and must handle overflow',
  },
  { id: 'unicode', label: 'spaces + wide unicode', value: '  🌊 東京 workspace ✨  ' },
];
export const editableTextStates = [
  'display',
  'editing',
  'edge-cases',
  'edge-cases-editing',
  'narrow',
] as const;

export function EditableTextPreview({ state }: { state: string }) {
  const root = useRef<HTMLDivElement>(null);
  const editing = state === 'editing' || state === 'edge-cases-editing' || state === 'narrow';
  const edges = state.startsWith('edge-cases');
  const cases = edges ? edgeCases : normalCases;
  const names = edges
    ? [
        ...cases,
        { id: 'disabled', label: 'disabled', value: 'Editing unavailable', disabled: true },
      ]
    : cases;
  const headers = edges
    ? [
        ...cases,
        {
          id: 'non-editable',
          label: 'editableTitle false',
          value: 'Read-only content',
          editable: false,
        },
      ]
    : cases;
  useLayoutEffect(() => {
    if (!editing || !root.current) return;
    const host = root.current;
    // Match the reference's mount-time native clicks and temporary blur suppression.
    // React bubbles focusout rather than the native blur event.
    const suppressBlur = (event: Event) => event.stopImmediatePropagation();
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      host.addEventListener('focusout', suppressBlur, true);
      try {
        const targets = Array.from(host.querySelectorAll<HTMLElement>('[data-edit-target]'));
        for (const target of targets)
          flushSync(() =>
            target.querySelector<HTMLButtonElement>('button:not(:disabled)')?.click(),
          );
        targets[0]?.querySelector<HTMLInputElement>('input[type="text"]')?.focus();
      } finally {
        host.removeEventListener('focusout', suppressBlur, true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [editing]);
  return (
    <div
      ref={root}
      className={cn('grid max-w-full gap-8 text-foreground', state === 'narrow' && 'w-70')}
      data-editable-text-preview
      data-catalog-coverage="partial"
      data-catalog-gap="WorkspaceSidebarHeader dense-context"
    >
      <section className="grid gap-3">
        <h2 className="text-lg font-semibold">EditableName</h2>
        <div className="grid gap-3 sm:grid-cols-[repeat(auto-fit,minmax(14rem,1fr))]">
          {names.map((example) => (
            <div
              key={example.id}
              className="min-w-0 rounded-md border border-border bg-background p-3"
              data-edit-target={editing && !example.disabled ? true : undefined}
              data-edit-value={example.editValue}
            >
              <p className="mb-3 text-xs text-muted-foreground">EditableName — {example.label}</p>
              <EditableName
                value={example.value}
                placeholder="Untitled preview"
                disabled={example.disabled}
                maxWidth={state === 'narrow' ? 220 : 180}
                onSave={() => undefined}
              />
            </div>
          ))}
        </div>
      </section>
      <section className="grid gap-3">
        <h2 className="text-lg font-semibold">ContentHeader</h2>
        <div className="grid gap-3 sm:grid-cols-[repeat(auto-fit,minmax(14rem,1fr))]">
          {headers.map((example) => (
            <div
              key={example.id}
              className="min-w-0 overflow-hidden rounded-md border border-border bg-background"
              data-edit-target={editing && example.editable !== false ? true : undefined}
              data-edit-value={example.editValue}
            >
              <p className="px-3 pt-3 text-xs text-muted-foreground">
                ContentHeader — {example.label}
              </p>
              <ContentHeader
                title={example.value}
                editableTitle={example.editable !== false}
                showClose={false}
                onTitleChange={() => undefined}
              />
            </div>
          ))}
        </div>
      </section>
      <p className="text-xs text-muted-foreground">
        Partial source scene: WorkspaceSidebarHeader is not ported. The dense-context state remains
        unavailable.
      </p>
    </div>
  );
}

export function HeaderExample({ panel = false }: { panel?: boolean }) {
  const [title, setTitle] = useState('Preview implementation plan');
  const [open, setOpen] = useState(true);
  const [events, setEvents] = useState<string[]>([]);
  const record = (event: string) => setEvents((previous) => [...previous, event]);
  const props = {
    title,
    subtitle: 'Editable content header',
    editableTitle: true,
    showClose: true,
    onTitleChange: (value: string) => {
      setTitle(value);
      record('title');
    },
    canGoBack: true,
    canGoForward: true,
    onNavigateBack: () => record('back'),
    onNavigateForward: () => record('forward'),
    onClose: () => {
      record('close');
      setOpen(false);
    },
    breadcrumbs: [{ label: 'Workspace', onClick: () => record('breadcrumb') }],
    actions: <Button onClick={() => record('action')}>Header action</Button>,
  };
  return (
    <div
      className="grid min-w-0 gap-4"
      data-testid={panel ? 'panel-wrapper-example' : 'content-header-example'}
    >
      <Button onClick={() => setOpen(true)}>Open header</Button>
      {panel ? (
        <div className="h-64">
          <PanelWrapper {...props} open={open}>
            <p>Panel content</p>
          </PanelWrapper>
        </div>
      ) : (
        open && <ContentHeader {...props} />
      )}
      <output data-testid="header-title">{title}</output>
      <output data-testid="header-events">{events.join(',')}</output>
    </div>
  );
}

export function IndicatorExample({ unsaved = false }: { unsaved?: boolean }) {
  const [count, setCount] = useState(0);
  const [visible, setVisible] = useState(false);
  return (
    <div
      className="flex flex-wrap items-center gap-3"
      data-testid={unsaved ? 'unsaved-indicator-example' : 'agent-badge-example'}
    >
      {unsaved ? (
        <>
          <Button onClick={() => setVisible((value) => !value)}>Toggle unsaved changes</Button>
          <UnsavedIndicator visible={visible} />
          <output data-testid="unsaved-visible">{String(visible)}</output>
        </>
      ) : (
        <>
          <Button onClick={() => setCount((value) => value + 1)}>Add unread message</Button>
          <Button onClick={() => setCount(0)}>Clear unread messages</Button>
          <AgentBadge count={count} />
          <output data-testid="agent-badge-count">{count}</output>
        </>
      )}
    </div>
  );
}
