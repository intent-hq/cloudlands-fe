import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import {
  CUSTOM_WORKBENCH_CASES,
  MERMAID_WORKBENCH_CASES,
} from '../src/lib/components/diagrams/diagram-workbench.preview-fixtures';
import { viteHarnessCacheDir } from './vite-harness-cache.mjs';

const externalBaseUrl = process.env.UI_PREVIEW_BASE_URL?.replace(/\/$/, '');
let baseUrl = externalBaseUrl ?? '';
let server: ViteDevServer | undefined;
test.describe.configure({ mode: 'default' });
test.setTimeout(90_000);
test.use({
  viewport: { width: 1500, height: 1000 },
  video: { mode: 'on', size: { width: 1500, height: 1000 } },
});

test.beforeAll(async ({}, workerInfo) => {
  if (externalBaseUrl) return;
  const ownedServer = await createServer({
    cacheDir: viteHarnessCacheDir('diagram-note-loading', { workerIndex: workerInfo.workerIndex }),
    server: { host: '127.0.0.1', port: 0, strictPort: false, watch: { ignored: ['**/*'] } },
  });
  server = ownedServer;
  try {
    await ownedServer.listen();
    baseUrl = ownedServer.resolvedUrls?.local[0]?.replace(/\/$/, '') ?? '';
    expect(baseUrl).not.toBe('');
  } catch (error) {
    await ownedServer.close().catch(() => undefined);
    server = undefined;
    throw error;
  }
});

test.afterAll(async () => {
  const ownedServer = server;
  server = undefined;
  await ownedServer?.close();
});

const flow = 'flowchart LR\n A[Receive request] --> B[Process request] --> C[Return result]';
const mermaid = (source: string) => `~~~mermaid\n${source}\n~~~`;
const custom = `\`\`\`diagram\n${JSON.stringify(CUSTOM_WORKBENCH_CASES['custom-architecture'].diagram)}\n\`\`\``;

type DiagramFrame = {
  visible: boolean;
  settled: boolean;
  generation: number;
  width: number;
  height: number;
  x: number;
  y: number;
};
type LoadFrame = {
  diagrams: DiagramFrame[];
  noteVisible: boolean;
  noteLoading: boolean;
  streaming: boolean;
  followingY: number | null;
  followingX: number | null;
};
type LoadingWindow = typeof window & {
  diagramLoadFrames: LoadFrame[];
  stopDiagramLoadCapture: () => void;
  releaseDiagramFont: () => void;
  diagramFontHeld: boolean;
  switchDiagramNote: (blocks: string[]) => void;
};

async function mountNote(
  page: Page,
  width: number,
  blocks: string[],
  { holdFont = false, hidden = false, shouldFocus = false, newlyCreated = false } = {},
) {
  await page.goto(`${baseUrl}/sandbox/button?state=default&motion=full`, {
    waitUntil: 'domcontentloaded',
  });
  await expect(page.locator('[data-preview-ready=true]')).toBeVisible({ timeout: 60_000 });
  await page.evaluate(
    async ({ width, blocks, holdFont, hidden, shouldFocus, newlyCreated }) => {
      const [{ mount }, { writable, fromStore }, { default: NoteWithComments }] = await Promise.all(
        [
          import('/@id/svelte'),
          import('/@id/svelte/store'),
          import('/src/lib/components/workspace/NoteWithComments.svelte'),
        ],
      );
      const host = document.createElement('div');
      host.id = 'diagram-loading-note';
      host.style.cssText = `width:${width}px;height:900px;margin-left:40px`;
      if (hidden) host.style.display = 'none';
      document.body.replaceChildren(host);
      const w = window as LoadingWindow;
      w.diagramLoadFrames = [];
      let stopped = false;
      w.stopDiagramLoadCapture = () => (stopped = true);
      if (holdFont) {
        const load = document.fonts.load.bind(document.fonts);
        const held = new Promise<void>((resolve) => (w.releaseDiagramFont = resolve));
        document.fonts.load = async (font, text) => {
          const faces = await load(font, text);
          if (host.querySelector('.sequence-note-text')) {
            w.diagramFontHeld = true;
            await held;
          }
          return faces;
        };
      }
      const visible = (element: Element) => {
        for (let node: Element | null = element; node; node = node.parentElement) {
          const style = getComputedStyle(node);
          if (style.visibility === 'hidden' || style.display === 'none' || +style.opacity === 0)
            return false;
        }
        return true;
      };
      const sample = () => {
        if (stopped) return;
        const diagrams = [...host.querySelectorAll('[data-diagram-presentation]')].map(
          (presentation) => {
            const svg = presentation.querySelector('.mermaid-svg > svg, .diagram-svg-layer');
            const renderer = presentation.querySelector<HTMLElement>(
              '.mermaid-renderer, .diagram-renderer',
            );
            const bounds = svg?.getBoundingClientRect();
            return {
              visible: !!svg && visible(svg),
              settled:
                presentation.getAttribute('data-diagram-presentation-settled') === 'true' &&
                (renderer?.dataset.renderSettled === 'true' ||
                  renderer?.dataset.diagramSettled === 'true'),
              generation: Number(renderer?.dataset.renderGeneration ?? 0),
              width: bounds?.width ?? 0,
              height: bounds?.height ?? 0,
              x: bounds?.x ?? 0,
              y: bounds?.y ?? 0,
            };
          },
        );
        const following = host.querySelector('.tiptap-editor > p:last-child');
        const wrapper = host.querySelector('.tiptap-editor-wrapper');
        w.diagramLoadFrames.push({
          diagrams,
          noteVisible: !!following && visible(following),
          noteLoading: wrapper?.getAttribute('aria-busy') === 'true',
          streaming: wrapper?.classList.contains('streaming-in') ?? false,
          followingY: following?.getBoundingClientRect().top ?? null,
          followingX: following?.getBoundingClientRect().left ?? null,
        });
        requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
      const noteContent = (blocks: string[]) =>
        `## Diagram loading\n\nText before the diagram.\n\n${blocks.join('\n\n')}\n\nText after the diagram.`;
      const initialNoteId = newlyCreated ? 'created-note' : undefined;
      if (newlyCreated) {
        const [{ store }, { addOptimisticNote }] = await Promise.all([
          import('/src/store/renderer/store.ts'),
          import('/src/store/renderer/slices/workspace-notes/workspace-notes-slice.ts'),
        ]);
        store.dispatch(
          addOptimisticNote('diagram-loading-test', {
            id: initialNoteId!,
            workspaceId: 'diagram-loading-test',
            title: 'Diagram loading',
            content: noteContent(blocks),
            contentType: 'markdown',
            tags: [],
            isPinned: false,
            isArchived: false,
            visibility: 'workspace',
            createdAt: '2026-10-02T00:00:00.000Z',
            updatedAt: '2026-10-02T00:00:00.000Z',
          }),
        );
      }
      const note = writable({
        content: noteContent(blocks),
        noteId: initialNoteId as string | undefined,
      });
      const currentNote = fromStore(note);
      w.switchDiagramNote = (blocks) => {
        w.diagramLoadFrames = [];
        stopped = false;
        requestAnimationFrame(sample);
        note.set({ content: noteContent(blocks), noteId: 'switched-note' });
      };
      mount(NoteWithComments, {
        target: host,
        props: {
          workspace: {
            id: 'diagram-loading-test',
            title: 'Diagram loading test',
            branch: 'test',
            changesets: [],
            timeline: [],
            conversationInfo: [],
            status: 'Active',
            createdAt: '2026-10-02T00:00:00.000Z',
            updatedAt: '2026-10-02T00:00:00.000Z',
          },
          get content() {
            return currentNote.current.content;
          },
          get noteId() {
            return currentNote.current.noteId;
          },
          editable: true,
          shouldFocus,
          showSuggestions: false,
          showComments: false,
        },
      });
    },
    { width, blocks, holdFont, hidden, shouldFocus, newlyCreated },
  );
}

async function finishCapture(page: Page, info: TestInfo, count = 1) {
  const presentations = page.locator('#diagram-loading-note [data-diagram-presentation]');
  await expect(presentations).toHaveCount(count);
  for (const presentation of await presentations.all()) {
    await expect(presentation).toHaveAttribute('data-diagram-presentation-settled', 'true', {
      timeout: 30_000,
    });
    await expect(presentation).toBeVisible();
  }
  await expect(page.locator('#diagram-loading-note .tiptap-editor-wrapper')).toHaveCSS(
    'opacity',
    '1',
  );
  await page.evaluate(async () => {
    for (let i = 0; i < 60; i++)
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  });
  const frames = await page.evaluate(() => {
    const w = window as LoadingWindow;
    w.stopDiagramLoadCapture();
    return w.diagramLoadFrames;
  });
  await info.attach('load-frames', {
    body: JSON.stringify(frames, null, 2),
    contentType: 'application/json',
  });
  return frames;
}

function expectStableReveal(frames: LoadFrame[], index = 0) {
  expectStableNote(frames);
  expect(
    frames.filter((frame) => frame.noteVisible).every((frame) => frame.diagrams[index]?.visible),
  ).toBe(true);
  const visible = frames.map((frame) => frame.diagrams[index]).filter((frame) => frame?.visible);
  expect(visible.length).toBeGreaterThan(1);
  for (const axis of ['width', 'height'] as const) {
    const sizes = visible.map((frame) => frame[axis]);
    expect(Math.min(...sizes)).toBeGreaterThan(0);
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
  }
  for (const axis of ['x', 'y'] as const) {
    const positions = visible.map((frame) => frame[axis]);
    expect(Math.max(...positions) - Math.min(...positions)).toBeLessThanOrEqual(1);
  }
}

function expectStableNote(frames: LoadFrame[]) {
  const firstVisible = frames.findIndex((frame) => frame.noteVisible);
  expect(firstVisible).toBeGreaterThanOrEqual(0);
  const visible = frames.slice(firstVisible);
  expect(visible.length).toBeGreaterThan(1);
  expect(visible.every((frame) => frame.noteVisible)).toBe(true);
  for (const axis of ['followingX', 'followingY'] as const) {
    const positions = visible.map((frame) => frame[axis]!);
    expect(Math.max(...positions) - Math.min(...positions)).toBeLessThanOrEqual(1);
  }
}

for (const [name, width, source] of [
  ['wide flowchart', 1336, flow],
  ['breakpoint flowchart', 712, flow],
  [
    'narrow state diagram',
    420,
    'stateDiagram-v2\n [*] --> Loading\n Loading --> Ready\n Ready --> [*]',
  ],
] as const) {
  test(`${name} appears at its final size on note load`, async ({ page }, info) => {
    await mountNote(page, width, [mermaid(source)]);
    const frames = await finishCapture(page, info);
    expectStableReveal(frames);
    const generations = frames.map((frame) => frame.diagrams[0]?.generation ?? 0);
    expect(Math.max(...generations)).toBe(1);
  });
}

test('a note opened from a hidden panel waits for its available width before revealing', async ({
  page,
}, info) => {
  await mountNote(page, 712, [mermaid(flow)], { hidden: true });
  const host = page.locator('#diagram-loading-note');
  await expect(host.locator('.mermaid-renderer')).toHaveAttribute('data-render-settled', 'true', {
    timeout: 30_000,
  });
  await host.evaluate((host) => host.style.removeProperty('display'));
  expectStableReveal(await finishCapture(page, info));
});

test('slow sequence fonts keep text and faster diagrams hidden until the note is ready', async ({
  page,
}, info) => {
  await mountNote(
    page,
    960,
    [mermaid(flow), mermaid(MERMAID_WORKBENCH_CASES['mermaid-sequence-note'].source)],
    { holdFont: true },
  );
  await expect
    .poll(() => page.evaluate(() => (window as LoadingWindow).diagramFontHeld))
    .toBe(true);
  const svg = page.locator('#diagram-loading-note .mermaid-svg > svg');
  await expect(svg).toHaveCount(2);
  const pendingVisible = await page.evaluate(() =>
    (window as LoadingWindow).diagramLoadFrames.some(
      (frame) => frame.noteVisible || frame.diagrams.some((diagram) => diagram.visible),
    ),
  );
  await page.evaluate(() => (window as LoadingWindow).releaseDiagramFont());
  const frames = await finishCapture(page, info, 2);
  expect(pendingVisible).toBe(false);
  expectStableReveal(frames);
  expectStableReveal(frames, 1);
});

test('requested editor focus waits for slow diagrams to finish loading', async ({ page }, info) => {
  await mountNote(page, 712, [mermaid(MERMAID_WORKBENCH_CASES['mermaid-sequence-note'].source)], {
    holdFont: true,
    shouldFocus: true,
  });
  await expect
    .poll(() => page.evaluate(() => (window as LoadingWindow).diagramFontHeld))
    .toBe(true);
  const editor = page.locator('#diagram-loading-note .tiptap-editor');
  await expect(editor).not.toBeFocused();
  await page.evaluate(() => (window as LoadingWindow).releaseDiagramFont());
  expectStableReveal(await finishCapture(page, info));
  await expect(editor).toBeFocused();
  await page.keyboard.type('Typing after loading.');
  await expect(editor).toContainText('Typing after loading.');
});

for (const withDiagram of [false, true]) {
  test(`new notes ${withDiagram ? 'with slow diagrams' : 'without diagrams'} animate only after loading`, async ({
    page,
  }, info) => {
    await mountNote(
      page,
      712,
      withDiagram
        ? [mermaid(MERMAID_WORKBENCH_CASES['mermaid-sequence-note'].source)]
        : ['A new plain note.'],
      { newlyCreated: true, holdFont: withDiagram },
    );
    if (withDiagram) {
      await expect
        .poll(() => page.evaluate(() => (window as LoadingWindow).diagramFontHeld))
        .toBe(true);
      // Cover the entire old animation window while layout is still blocked.
      await page.waitForTimeout(1_100);
      await page.evaluate(() => (window as LoadingWindow).releaseDiagramFont());
    }
    const frames = await finishCapture(page, info, withDiagram ? 1 : 0);
    expect(
      frames
        .filter((frame) => frame.noteLoading)
        .every(
          (frame) =>
            !frame.noteVisible &&
            !frame.streaming &&
            frame.diagrams.every((diagram) => !diagram.visible),
        ),
    ).toBe(true);
    expect(frames.some((frame) => frame.streaming && frame.noteVisible)).toBe(true);
    const firstVisible = frames.findIndex((frame) => frame.noteVisible);
    expect(firstVisible).toBeGreaterThanOrEqual(0);
    expect(frames.slice(firstVisible).every((frame) => frame.noteVisible)).toBe(true);
    if (withDiagram) {
      const visible = frames.map((frame) => frame.diagrams[0]).filter((frame) => frame?.visible);
      expect(visible.length).toBeGreaterThan(1);
      expect(visible.every((frame) => frame.settled)).toBe(true);
      for (const axis of ['width', 'height'] as const) {
        const sizes = visible.map((frame) => frame[axis]);
        expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
      }
    }
    await expect(page.locator('#diagram-loading-note .tiptap-editor-wrapper')).not.toHaveClass(
      /streaming-in/,
    );
  });
}

test('switching notes during the new-note animation cancels its reveal', async ({ page }, info) => {
  await mountNote(page, 712, ['A new plain note.'], { newlyCreated: true, holdFont: true });
  await expect(page.locator('#diagram-loading-note .tiptap-editor-wrapper')).toHaveClass(
    /streaming-in/,
  );
  await page.evaluate(
    (blocks) => (window as LoadingWindow).switchDiagramNote(blocks),
    [mermaid(MERMAID_WORKBENCH_CASES['mermaid-sequence-note'].source)],
  );
  await expect
    .poll(() => page.evaluate(() => (window as LoadingWindow).diagramFontHeld))
    .toBe(true);
  await page.waitForTimeout(1_100);
  await page.evaluate(() => (window as LoadingWindow).releaseDiagramFont());
  const frames = await finishCapture(page, info);
  expectStableReveal(frames);
  expect(frames.filter((frame) => frame.noteLoading).every((frame) => !frame.streaming)).toBe(true);
});

test('multiple diagram types reveal together and walkthrough steps stay visible', async ({
  page,
}, info) => {
  await mountNote(page, 960, [mermaid(flow), custom]);
  const frames = await finishCapture(page, info, 2);
  expectStableReveal(frames, 0);
  expectStableReveal(frames, 1);
  const renderer = page.locator('#diagram-loading-note .diagram-renderer');
  const initial = await renderer.getAttribute('data-diagram-state');
  await renderer.locator('[data-diagram-step-index="1"]').click();
  await expect(renderer).not.toHaveAttribute('data-diagram-state', initial!);
  await expect(renderer.locator('.diagram-svg-layer')).toBeVisible();
  await expect(renderer).toHaveAttribute('data-diagram-settled', 'true');
});

test('plain notes do not wait for diagrams', async ({ page }, info) => {
  await mountNote(page, 712, ['A note without diagrams.']);
  expectStableNote(await finishCapture(page, info, 0));
  await expect(
    page.locator('.tiptap-editor').getByText('A note without diagrams.', { exact: true }),
  ).toBeVisible();
});

test('large notes wait for deferred content and diagram layout', async ({ page }, info) => {
  await mountNote(page, 712, [mermaid(flow), 'More note content. '.repeat(320)]);
  expectStableReveal(await finishCapture(page, info));
});

test('diagrams inside a blockquote finish layout before the note appears', async ({
  page,
}, info) => {
  await mountNote(page, 712, [
    mermaid(flow)
      .split('\n')
      .map((line) => `> ${line}`)
      .join('\n'),
  ]);
  expectStableReveal(await finishCapture(page, info));
});

test('switching notes waits for the new diagrams and releases the old observer', async ({
  page,
}, info) => {
  await mountNote(page, 712, [mermaid(flow)]);
  expectStableReveal(await finishCapture(page, info));
  await page.evaluate(
    (blocks) => (window as LoadingWindow).switchDiagramNote(blocks),
    [mermaid(MERMAID_WORKBENCH_CASES['mermaid-sequence-note'].source)],
  );
  expectStableReveal(await finishCapture(page, info));
  await page.evaluate(async () => {
    const [{ store }, { setNoteViewMode }] = await Promise.all([
      import('/src/store/renderer/store.ts'),
      import('/src/store/renderer/slices/transient-ui/transient-ui-slice.ts'),
    ]);
    store.dispatch(setNoteViewMode('diagram-loading-test', 'switched-note', 'raw'));
  });
  await expect(page.getByTestId('raw-note-view')).toBeVisible();
  await expect(page.getByTestId('raw-note-view')).toContainText('sequenceDiagram');
  await page.evaluate(async () => {
    const [{ store }, { setNoteViewMode }] = await Promise.all([
      import('/src/store/renderer/store.ts'),
      import('/src/store/renderer/slices/transient-ui/transient-ui-slice.ts'),
    ]);
    store.dispatch(setNoteViewMode('diagram-loading-test', 'switched-note', 'editor'));
  });
  await expect(page.locator('#diagram-loading-note .tiptap-editor-wrapper')).toHaveCSS(
    'opacity',
    '1',
  );
  await expect(page.locator('#diagram-loading-note .mermaid-svg > svg')).toBeVisible();
});

test('empty sources and plain-text fallback do not trap the note loading state', async ({
  page,
}, info) => {
  await mountNote(page, 712, [mermaid('')]);
  expectStableNote(await finishCapture(page, info));
  await expect(page.locator('#diagram-loading-note .mermaid-empty')).toBeVisible();
  await page.evaluate(
    (blocks) => (window as LoadingWindow).switchDiagramNote(blocks),
    ['Plain-text fallback content. '.repeat(8000)],
  );
  await expect(page.locator('#diagram-loading-note pre').first()).toBeVisible();
  await expect(page.locator('#diagram-loading-note pre').first()).toContainText(
    'Plain-text fallback content.',
  );
});

test('initial sizing preserves correction of unreadable authored label colors', async ({
  page,
}, info) => {
  await mountNote(page, 960, [mermaid(`${flow}\n style A fill:#222222,color:#222222`)]);
  expectStableReveal(await finishCapture(page, info));
  const contrast = await page
    .locator('#diagram-loading-note g.node')
    .first()
    .evaluate((node) => {
      const luminance = (color: string) => {
        const channels = color
          .match(/[\d.]+/g)!
          .slice(0, 3)
          .map(Number)
          .map((value) => {
            const normalized = value / 255;
            return normalized <= 0.04045
              ? normalized / 12.92
              : ((normalized + 0.055) / 1.055) ** 2.4;
          });
        return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
      };
      const background = luminance(getComputedStyle(node.querySelector('rect')!).fill);
      const foreground = luminance(getComputedStyle(node.querySelector('.nodeLabel p')!).color);
      return (Math.max(background, foreground) + 0.05) / (Math.min(background, foreground) + 0.05);
    });
  expect(contrast).toBeGreaterThanOrEqual(4.5);
});

test('loaded diagrams resize with the panel and keep wide content reachable', async ({
  page,
}, info) => {
  await mountNote(page, 960, [mermaid(flow)]);
  await finishCapture(page, info);
  const host = page.locator('#diagram-loading-note');
  const renderer = host.locator('.mermaid-renderer');
  for (const width of [320, 960]) {
    const generation = Number(await renderer.getAttribute('data-render-generation'));
    await host.evaluate((host, width) => (host.style.width = `${width}px`), width);
    await expect
      .poll(async () => Number(await renderer.getAttribute('data-render-generation')))
      .toBeGreaterThan(generation);
    await expect(renderer).toHaveAttribute('data-render-settled', 'true');
    await expect(host.locator('[data-diagram-presentation]')).toHaveAttribute(
      'data-diagram-presentation-settled',
      'true',
    );
    const viewport = host.locator('.mermaid-svg-viewport');
    await expect(viewport).toBeVisible();
    const overflow = await viewport.evaluate(
      (element) => element.scrollWidth - element.clientWidth,
    );
    if (width === 320) {
      expect(overflow).toBeGreaterThan(0);
      await viewport.hover();
      await page.mouse.wheel(overflow, 0);
      await expect
        .poll(() => viewport.evaluate((element) => element.scrollLeft))
        .toBeGreaterThan(0);
    }
  }
});

test('invalid and empty sources remain accessible and recover through the note editor', async ({
  page,
}) => {
  await mountNote(page, 712, [mermaid('unsupportedDiagram invalid')]);
  const host = page.locator('#diagram-loading-note');
  await expect(host.getByRole('alert')).toBeVisible({ timeout: 30_000 });
  await host.locator('.mermaid-error').hover();
  await host.getByRole('button', { name: 'Edit code', exact: true }).click();
  const textarea = host.locator('textarea');
  await textarea.fill('');
  await expect(host.locator('.mermaid-empty')).toBeVisible();
  await textarea.fill(flow);
  await expect(host.locator('.mermaid-svg > svg')).toBeVisible();
  await expect(host.locator('.mermaid-renderer')).toHaveAttribute('data-render-settled', 'true');
  await expect(host.getByRole('alert')).toHaveCount(0);
});
