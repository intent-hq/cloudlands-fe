/**
 * @vitest-environment jsdom
 *
 * Mention token contract: every mention type the composer can produce is
 * saved through the real serializer, then read back by every reader. Each
 * reader must recover the same type, id, label and workspace.
 *
 * Why: the readers used to carry their own copies of the token grammar. They
 * drifted apart in cloudlands-fe#3845 (note titles saved, ids read back cut at
 * the first space), and the review found the broken readers one round at a
 * time. This test names them all in one place:
 *
 * - chat: the chat bubble (`findInlineMentions` + `decodeInlineMention`).
 * - injector: the worker-side `injectMentionSpans` (large notes, read-only views).
 * - note-editor: `processMarkdownToHTML` chips, then `processHTMLToMarkdown`
 *   must give back the exact token (the editable note round trip).
 * - preview: plain-text previews (`stripUserMessagePrefixes`, queued messages).
 * - click: the note editor's click handler run on the rebuilt chip. The chat
 *   composer (TipTapEditor) and MarkdownViewer click handlers live in .svelte
 *   files; all three read chips through `readMentionChip`, which the injector
 *   and note-editor readers use to check the rebuilt chip.
 *
 * Known gaps are listed in KNOWN_GAPS and run with `it.fails`. When a fix
 * makes one pass, its `it.fails` fails: delete the entry so the case becomes
 * a normal passing test. A new default mention provider without a fixture
 * fails the coverage test below.
 *
 * Every reader takes its patterns and parsing from the mention registry
 * (registry.ts); this test checks the readers still agree end to end.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  decodeInlineMention,
  findInlineMentions,
  type DecodedInlineMention,
} from '$lib/components/chat/mention-match-utils';
import { createEditorConfig, mentionRenderText } from '$lib/utils/editor-config';
import { injectMentionSpans } from '$lib/utils/markdown-mention-injector';
import { processHTMLToMarkdown, processMarkdownToHTML } from '$lib/utils/markdown-processor';
import { stripUserMessagePrefixes } from '$lib/utils/text-utils';
import { noteUrl } from '$shared/constants/intent-links';
import { initAppStore, store } from '$store/renderer/store';
import { readMentionChip } from './chip';
import { mentionTokensToText, toPromptToken } from './registry';
import { providerRegistry } from './providers';
import type { MentionCandidate } from './types';

const mocks = vi.hoisted(() => ({ handleLink: vi.fn() }));
vi.mock('$features/navigation/link-handler', () => ({ handleLink: mocks.handleLink }));
vi.mock(
  '$store/renderer/slices/workspace-navigation/workspace-navigation-slice',
  async (importOriginal) => ({
    ...(await importOriginal<object>()),
    openWorkspaceFile: (...args: unknown[]) => ({ type: 'test/openWorkspaceFile', args }),
    openWorkspaceNote: (...args: unknown[]) => ({ type: 'test/openWorkspaceNote', args }),
  }),
);
vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: vi.fn(),
  onBackendNotification: vi.fn(() => () => {}),
  onBackendReconnected: vi.fn(() => () => {}),
}));
vi.mock('$lib/electron-bridge', () => ({
  invoke: vi.fn(async () => ({})),
  listenSync: vi.fn(() => () => {}),
}));

const CURRENT_WS = 'ws-1';

/** What a reader recovers from a saved token. */
interface ReadBack {
  type: string;
  id: string;
  label: string;
  /** Set only when the token must carry a workspace (cross-workspace note, member). */
  workspaceId?: string;
}

/** Where clicking the rebuilt chip in the note editor must navigate. */
type ClickTarget =
  { kind: 'file'; path: string } | { kind: 'note'; id: string; workspaceId?: string };

interface Fixture {
  name: string;
  /** Default provider that produces this candidate. */
  provider: string;
  candidate: Pick<MentionCandidate, 'type' | 'id' | 'label' | 'meta'>;
  expected: ReadBack;
  click?: ClickTarget;
}

const NOTE_ID = '3f2a9c1e-7b4d-4e8a-9f10-2c5d6e7f8a9b';

const FIXTURES: Fixture[] = [
  {
    name: 'file',
    provider: 'file',
    candidate: {
      type: 'file',
      id: 'file-src/lib/a.ts',
      label: 'a.ts',
      meta: { path: 'src/lib/a.ts', fullPath: 'src/lib/a.ts' },
    },
    expected: { type: 'file', id: 'src/lib/a.ts', label: 'src/lib/a.ts' },
    click: { kind: 'file', path: 'src/lib/a.ts' },
  },
  {
    name: 'file range',
    provider: 'file',
    candidate: {
      type: 'file-range',
      id: 'file-src/lib/a.ts',
      label: 'a.ts',
      meta: { fullPath: 'src/lib/a.ts', range: { start: 3, end: 7 } },
    },
    expected: { type: 'file', id: 'src/lib/a.ts', label: 'src/lib/a.ts' },
    click: { kind: 'file', path: 'src/lib/a.ts' },
  },
  {
    name: 'file path with a space',
    provider: 'file',
    candidate: {
      type: 'file',
      id: 'file-my dir/a.ts',
      label: 'a.ts',
      meta: { path: 'my dir/a.ts', fullPath: 'my dir/a.ts' },
    },
    expected: { type: 'file', id: 'my dir/a.ts', label: 'my dir/a.ts' },
    click: { kind: 'file', path: 'my dir/a.ts' },
  },
  {
    name: 'folder',
    provider: 'folder',
    candidate: {
      type: 'folder',
      id: 'folder-src/lib',
      label: 'lib',
      meta: { path: 'src/lib', fullPath: 'src/lib' },
    },
    // Saved as `@src/lib/`: the trailing slash marks a folder. Chat shows it
    // as a folder chip; rich text rebuilds a folder chip.
    expected: { type: 'folder', id: 'src/lib', label: 'src/lib/' },
  },
  {
    name: 'note with spaces in its title',
    provider: 'note',
    candidate: {
      type: 'note',
      id: NOTE_ID,
      label: 'Meeting with Andre Oct 30 2026',
      meta: { workspaceId: CURRENT_WS },
    },
    expected: { type: 'note', id: NOTE_ID, label: 'Meeting with Andre Oct 30 2026' },
    click: { kind: 'note', id: NOTE_ID },
  },
  {
    name: 'note in another workspace',
    provider: 'note',
    candidate: {
      type: 'note',
      id: NOTE_ID,
      label: 'Other plan',
      meta: { workspaceId: 'ws-2', isExternalLink: true },
    },
    expected: { type: 'note', id: NOTE_ID, label: 'Other plan', workspaceId: 'ws-2' },
    click: { kind: 'note', id: NOTE_ID, workspaceId: 'ws-2' },
  },
  {
    name: 'terminal with a space in its name',
    provider: 'terminal',
    candidate: {
      type: 'terminal',
      id: 'terminal-1730000000-ab12',
      label: 'Build server',
      meta: { workspaceId: CURRENT_WS },
    },
    expected: { type: 'terminal', id: 'terminal-1730000000-ab12', label: 'Build server' },
  },
  {
    name: 'terminal with a one-word name',
    provider: 'terminal',
    candidate: { type: 'terminal', id: 'pty-0', label: 'zsh', meta: { workspaceId: CURRENT_WS } },
    expected: { type: 'terminal', id: 'pty-0', label: 'zsh' },
  },
  {
    name: 'script with a space in its name',
    provider: 'script',
    candidate: {
      type: 'script',
      id: 'dev-server',
      label: 'Dev server',
      meta: { workspaceId: CURRENT_WS, command: 'pnpm dev' },
    },
    expected: { type: 'script', id: 'dev-server', label: 'Dev server' },
  },
  {
    // HTML character references in a name must not become token delimiters
    // once the note editor parses its Markdown into HTML.
    name: 'terminal whose name contains HTML character references',
    provider: 'terminal',
    candidate: {
      type: 'terminal',
      id: 'pty-1',
      label: 'Build &#93; server &amp; logs',
      meta: { workspaceId: CURRENT_WS },
    },
    expected: { type: 'terminal', id: 'pty-1', label: 'Build &#93 server &amp logs' },
  },
  {
    name: 'script whose name contains HTML character references',
    provider: 'script',
    candidate: {
      type: 'script',
      id: 's-2',
      label: 'R&D &#x5b;x',
      meta: { workspaceId: CURRENT_WS },
    },
    expected: { type: 'script', id: 's-2', label: 'R&D &#x5bx' },
  },
  {
    name: 'note whose title contains HTML character references',
    provider: 'note',
    candidate: {
      type: 'note',
      id: 'n-3',
      label: 'Plan &#93; review',
      meta: { workspaceId: CURRENT_WS },
    },
    expected: { type: 'note', id: 'n-3', label: 'Plan &#93 review' },
    click: { kind: 'note', id: 'n-3' },
  },
  {
    name: 'agent',
    provider: 'agent',
    candidate: {
      type: 'agent',
      id: 'agent-7f3c',
      label: 'Build agent',
      meta: { workspaceId: CURRENT_WS },
    },
    expected: { type: 'agent', id: 'agent-7f3c', label: 'Build agent' },
  },
  {
    name: 'specialist',
    provider: 'specialist',
    candidate: {
      type: 'specialist',
      id: 'specialist-implementor',
      label: 'Implementor',
      meta: { promptToken: 'specialist/implementor' } as MentionCandidate['meta'],
    },
    expected: { type: 'specialist', id: 'implementor', label: 'Implementor' },
  },
  {
    name: 'member',
    provider: 'member',
    candidate: {
      type: 'member',
      id: 'member-p1',
      label: 'octocat',
      meta: {
        workspaceId: CURRENT_WS,
        principalId: 'p1',
        identity: { provider: 'github', host: 'github.com', externalUserId: '583231' },
      },
    },
    expected: { type: 'member', id: 'member-p1', label: 'octocat', workspaceId: CURRENT_WS },
  },
];

type Reader = 'chat' | 'injector' | 'note-editor' | 'preview' | 'click';

const PATH_GAP = 'Path tokens are whitespace-delimited, so readers cut the path at the space.';
const AGENT_GAP = 'Agent tokens save only the name (`@Build agent`), no id; no reader parses them.';
const SPECIALIST_GAP =
  '`@specialist/<id>` has no reader of its own; chat reads it as a file path, the note editor as text.';

/**
 * Known gaps: `<fixture name>/<reader>` → why it fails today. Each runs with
 * `it.fails`; delete the entry once a fix makes the case pass.
 */
const KNOWN_GAPS: Record<string, string> = {
  'file path with a space/chat': PATH_GAP,
  'file path with a space/injector': PATH_GAP,
  'file path with a space/note-editor': PATH_GAP,
  'file path with a space/click': PATH_GAP,
  'agent/chat': AGENT_GAP,
  'agent/injector': AGENT_GAP,
  'agent/note-editor': AGENT_GAP,
  'specialist/chat': SPECIALIST_GAP,
  'specialist/injector': SPECIALIST_GAP,
  'specialist/note-editor': SPECIALIST_GAP,
  'specialist/preview': SPECIALIST_GAP,
};

/** Path-like tokens: the token text is the path (a folder's ends in `/`). */
const PATH_TYPES = new Set(['file', 'folder']);

/**
 * Per-type display rules (one rule per type, not per reader):
 * - chat shows a path chip by its last path segment (with any line suffix);
 * - rich-text chips show a path token as written (line suffix included);
 * - previews show a path token as-is, and every other token as `@<label>`.
 */
function expectedFor(reader: Reader, fixture: Fixture, token: string): ReadBack {
  if (!PATH_TYPES.has(fixture.expected.type)) return fixture.expected;
  if (reader === 'chat') {
    // Chat shows a path chip by its last segment; folders keep their type.
    const path = fixture.expected.id;
    if (fixture.expected.type === 'folder') {
      return { type: 'folder', id: path, label: path.split('/').pop()! };
    }
    return {
      type: 'file',
      id: path,
      label: `${path.split('/').pop()}${token.slice(1 + path.length).replace(/^\/$/, '')}`,
    };
  }
  return { ...fixture.expected, label: token.slice(1) };
}

function previewFor(fixture: Fixture, token: string): string {
  return PATH_TYPES.has(fixture.expected.type) ? token : `@${fixture.expected.label}`;
}

function readChat(decoded: DecodedInlineMention): ReadBack | { type: string } {
  switch (decoded.kind) {
    case 'note':
      return {
        type: 'note',
        id: decoded.note.id,
        label: decoded.note.title,
        workspaceId: decoded.note.workspaceId,
      };
    case 'member':
      return {
        type: 'member',
        id: decoded.member.id,
        label: decoded.member.label,
        workspaceId: decoded.member.meta?.workspaceId,
      };
    case 'runtime':
      return { type: decoded.mention.kind, id: decoded.mention.id, label: decoded.mention.name };
    case 'file':
      return { type: 'file', id: decoded.path, label: decoded.label };
    case 'folder':
      return { type: 'folder', id: decoded.path, label: decoded.label };
    default:
      return { type: decoded.kind };
  }
}

/** Read a rebuilt chip the way the click handlers do (`readMentionChip`). */
function readChip(chip: Element): ReadBack {
  const read = readMentionChip(chip)!;
  return {
    type: read.type,
    id: read.filePath ?? read.note?.id ?? read.id,
    label: read.label,
    workspaceId: read.meta.workspaceId || undefined,
  };
}

/** The paragraph holds exactly one chip and no leftover token text around it. */
function expectSingleChip(html: string, expected: ReadBack): HTMLElement {
  const container = document.createElement('div');
  container.innerHTML = html;
  const chips = container.querySelectorAll('[data-mention]');
  expect(chips).toHaveLength(1);
  const chip = chips[0] as HTMLElement;
  expect(readChip(chip)).toEqual(expected);
  if (expected.type === 'note' && expected.workspaceId) {
    expect(JSON.parse(chip.getAttribute('data-meta') || '{}').isExternalLink).toBe(true);
  }
  const paragraph = chip.closest('p') ?? container;
  const rest = paragraph.cloneNode(true) as HTMLElement;
  rest.querySelector('[data-mention]')?.remove();
  expect(rest.textContent).toBe('before  after');
  return chip;
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const READERS: Record<Reader, (fixture: Fixture, token: string) => void | Promise<void>> = {
  chat(fixture, token) {
    const matches = findInlineMentions(`before ${token} after`);
    expect(matches.map((m) => m.fullMatch)).toEqual([token]);
    expect(readChat(decodeInlineMention(matches[0]))).toEqual(expectedFor('chat', fixture, token));
  },
  injector(fixture, token) {
    const html = injectMentionSpans(`<p>before ${escapeHtml(token)} after</p>`);
    expectSingleChip(html, expectedFor('injector', fixture, token));
  },
  async 'note-editor'(fixture, token) {
    const md = `before ${token} after`;
    const html = await processMarkdownToHTML(md);
    expectSingleChip(html, expectedFor('note-editor', fixture, token));
    expect(processHTMLToMarkdown(html).trim()).toBe(md);
  },
  preview(fixture, token) {
    const expected = `before ${previewFor(fixture, token)} after`;
    expect(stripUserMessagePrefixes(`before ${token} after`)).toBe(expected);
    expect(mentionTokensToText(`before ${token} after`)).toBe(expected);
  },
  async click(fixture, token) {
    const target = fixture.click!;
    const element = document.createElement('div');
    element.dataset.panelId = 'panel-note';
    element.innerHTML = await processMarkdownToHTML(`before ${token} after`);
    const chip = element.querySelector('[data-mention]');
    expect(chip).not.toBeNull();
    const config = createEditorConfig({
      element,
      content: '',
      editable: true,
      onUpdate: () => {},
      workspace: { id: CURRENT_WS },
    });
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'target', { value: chip });
    config.editorProps?.handleClick?.({} as never, 0, event);

    const dispatched = vi.mocked(store.dispatch).mock.calls.map(([a]) => a as any);
    if (target.kind === 'file') {
      expect(dispatched.map((a) => [a.type, a.args?.[0], a.args?.[1]])).toEqual([
        ['test/openWorkspaceFile', CURRENT_WS, target.path],
      ]);
    } else if (target.workspaceId) {
      expect(dispatched).toEqual([]);
      expect(mocks.handleLink.mock.calls.map(([url]) => url)).toEqual([
        noteUrl(target.id, target.workspaceId),
      ]);
    } else {
      expect(dispatched.map((a) => [a.type, a.args?.[0], a.args?.[1]])).toEqual([
        ['test/openWorkspaceNote', CURRENT_WS, target.id],
      ]);
    }
  },
};

const READER_NAMES = Object.keys(READERS) as Reader[];

function appliesTo(reader: Reader, fixture: Fixture): boolean {
  return reader !== 'click' || fixture.click !== undefined;
}

describe('mention token contract', () => {
  beforeAll(() => {
    initAppStore(store);
  });
  beforeEach(() => {
    vi.spyOn(store, 'dispatch').mockImplementation((action: any) => action);
    mocks.handleLink.mockClear();
  });
  afterEach(() => vi.restoreAllMocks());

  it('has a fixture for every default mention provider', () => {
    const covered = new Set(FIXTURES.map((f) => f.provider));
    const missing = providerRegistry
      .getDefault()
      .map((p) => p.id)
      .filter((id) => !covered.has(id));
    expect(missing).toEqual([]);
  });

  it('lists only known gaps that name a real fixture and reader', () => {
    const cases = new Set(
      FIXTURES.flatMap((f) =>
        READER_NAMES.filter((r) => appliesTo(r, f)).map((r) => `${f.name}/${r}`),
      ),
    );
    expect(Object.keys(KNOWN_GAPS).filter((key) => !cases.has(key))).toEqual([]);
  });

  for (const fixture of FIXTURES) {
    describe(fixture.name, () => {
      const token = toPromptToken(fixture.candidate);

      it('serializes the same token from the composer and the note editor', () => {
        const node = { attrs: fixture.candidate } as never;
        expect(mentionRenderText({ node })).toBe(token);
      });

      for (const reader of READER_NAMES) {
        if (!appliesTo(reader, fixture)) continue;
        const gap = KNOWN_GAPS[`${fixture.name}/${reader}`];
        const run = () => READERS[reader](fixture, token);
        if (gap) {
          it.fails(`${reader} (known gap: ${gap})`, run);
        } else {
          it(`${reader} reads back ${token}`, run);
        }
      }
    });
  }
});
