// @vitest-environment node
import { mkdtemp, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain .mjs module without type declarations
import {
  analyzeSamples,
  analyzeTrace,
  parseArgs,
  prepareOutDir,
  summarize,
} from './chat-motion-lib.mjs';

const MAIN = { pid: 1, tid: 1 };
const event = (name: string, ts: number, dur = 0, extra: Record<string, unknown> = {}) => ({
  ...MAIN,
  name,
  ts,
  dur,
  ...extra,
});
const MARK_TS = 1_000_000;
const TRACE = [
  event('collapse', MARK_TS),
  event('RunTask', MARK_TS + 1_000, 5_000),
  event('RunTask', MARK_TS + 10_000, 21_300),
  event('RunTask', MARK_TS + 399_000, 8_000),
  event('RunTask', MARK_TS + 400_000, 90_000),
  event('RunTask', MARK_TS + 20_000, 90_000, { tid: 7 }),
  event('RunTask', MARK_TS - 1, 90_000),
  event('UpdateLayoutTree', MARK_TS + 2_000, 3_500, { args: { elementCount: 120 } }),
  event('UpdateLayoutTree', MARK_TS + 12_000, 1_200, { args: { elementCount: 9_800 } }),
  event('EventDispatch', MARK_TS + 500, 200, { args: { data: { type: 'click' } } }),
  event('EventDispatch', MARK_TS + 600, 200, { args: { data: { type: 'pointerdown' } } }),
  event('FunctionCall', MARK_TS + 250_000, 400, {
    args: { data: { functionName: 'animation.onfinish' } },
  }),
  event('FunctionCall', MARK_TS + 260_000, 400, { args: { data: { functionName: 'tick' } } }),
  event('expand', MARK_TS + 1_000_000),
  event('RunTask', MARK_TS + 1_005_000, 2_000),
];

describe('perf harness arguments', () => {
  it('applies the harness defaults', () => {
    expect(parseArgs(['--url', 'http://127.0.0.1:5173/workspace/w', '--out', 'runs/a'])).toEqual({
      url: 'http://127.0.0.1:5173/workspace/w',
      out: 'runs/a',
      scenario: 'footer',
      inflate: 10_000,
      frames: 40,
      scrollUp: 800,
      quietMs: 750,
      quietTimeout: 15_000,
      timeout: 180_000,
      headed: false,
    });
  });

  it('parses every override', () => {
    expect(
      parseArgs([
        '--url',
        'http://127.0.0.1:5173/workspace/w',
        '--out',
        'runs/b',
        '--scenario',
        'context-well',
        '--inflate',
        '0',
        '--frames',
        '12',
        '--scroll-up',
        '300',
        '--quiet-ms',
        '500',
        '--quiet-timeout',
        '9000',
        '--timeout',
        '60000',
        '--headed',
      ]),
    ).toMatchObject({
      scenario: 'context-well',
      inflate: 0,
      frames: 12,
      scrollUp: 300,
      quietMs: 500,
      quietTimeout: 9_000,
      timeout: 60_000,
      headed: true,
    });
  });

  it.each([
    { args: ['--out', 'runs/a'], message: /--url is required/ },
    { args: ['--url', 'http://127.0.0.1:5173/'], message: /--out is required/ },
    { args: ['--url', 'ftp://host/', '--out', 'x'], message: /--url must be a valid HTTP/ },
    {
      args: ['--url', 'http://h/', '--out', 'x', '--scenario', 'nav'],
      message: /--scenario must be/,
    },
    {
      args: ['--url', 'http://h/', '--out', 'x', '--frames', '1.5'],
      message: /--frames must be an integer/,
    },
    {
      args: ['--url', 'http://h/', '--out', 'x', '--inflate', 'many'],
      message: /--inflate must be an integer/,
    },
    {
      args: ['--url', 'http://h/', '--out', 'x', '--frames', '0'],
      message: /--frames must be an integer from 1/,
    },
    {
      args: ['--url', 'http://h/', '--out', 'x', '--quiet-ms'],
      message: /--quiet-ms requires a value/,
    },
    { args: ['--url', 'http://h/', '--out', 'x', '--out', 'y'], message: /only be specified once/ },
    {
      args: ['--url', 'http://h/', '--out', 'x', '--speed', '1'],
      message: /Unknown option: --speed/,
    },
  ])('rejects invalid arguments: $args', ({ args, message }) => {
    expect(() => parseArgs(args)).toThrow(message);
  });
});

describe('prepareOutDir', () => {
  it('creates a fresh directory and refuses to reuse an existing one', async () => {
    const base = await mkdtemp(path.join(tmpdir(), 'chat-motion-'));
    const out = path.join(base, 'nested', 'run');

    await expect(prepareOutDir(out)).resolves.toBe(out);
    await writeFile(path.join(out, 'trace.json'), '{}');

    await expect(prepareOutDir(out)).rejects.toThrow(
      `refusing to overwrite existing output directory ${out}`,
    );
    expect(await readdir(out)).toEqual(['trace.json']);
  });
});

describe('analyzeTrace', () => {
  it('scopes each mark to its thread and a 400ms window', () => {
    const motions = analyzeTrace(TRACE, { marks: ['collapse', 'expand'], windowMs: 400 });

    expect(motions.collapse).toEqual({
      windowMs: 400,
      taskCount: 3,
      maxTaskMs: 21.3,
      tasksOver16_7: [{ offsetMs: 10, durationMs: 21.3 }],
      maxUpdateLayoutTreeMs: 3.5,
      maxUpdateLayoutTreeElements: 9_800,
      clicks: [{ offsetMs: 0.5, durationMs: 0.2 }],
      transitionFinishes: [{ offsetMs: 250, durationMs: 0.4 }],
    });
    expect(motions.expand).toMatchObject({ taskCount: 1, maxTaskMs: 2, tasksOver16_7: [] });
  });

  it('omits marks absent from the trace and reports zeros for empty windows', () => {
    const motions = analyzeTrace([event('open', 10)], { marks: ['open', 'close'] });

    expect(Object.keys(motions)).toEqual(['open']);
    expect(motions.open).toMatchObject({ taskCount: 0, maxTaskMs: 0, maxUpdateLayoutTreeMs: 0 });
  });
});

describe('analyzeSamples', () => {
  it('measures scroll pinning and anchor drift', () => {
    expect(
      analyzeSamples([
        { top: 1000, max: 1000, anchorTop: 300, anchorConnected: true },
        { top: 990, max: 1004, anchorTop: 304.5, anchorConnected: true },
        { top: 1004, max: 1004, anchorTop: 298, anchorConnected: true },
      ]),
    ).toEqual({
      frames: 3,
      maxBottomGap: 14,
      topRange: 14,
      anchorDriftPx: 6.5,
      anchorStayedConnected: true,
    });
  });

  it('reports a disconnected anchor', () => {
    expect(
      analyzeSamples([
        { top: 10, max: 900, anchorTop: 120, anchorConnected: true },
        { top: 10, max: 900, anchorTop: 0, anchorConnected: false },
      ]),
    ).toMatchObject({ anchorDriftPx: 120, anchorStayedConnected: false });
  });

  it('returns null anchor metrics when no anchor was tracked', () => {
    expect(analyzeSamples([{ top: 5, max: 5 }])).toEqual({
      frames: 1,
      maxBottomGap: 0,
      topRange: 0,
      anchorDriftPx: null,
      anchorStayedConnected: null,
    });
  });
});

describe('summarize', () => {
  it('assembles the summary.json shape', () => {
    const summary = summarize({
      url: 'http://127.0.0.1:5173/workspace/w',
      scenario: 'footer',
      startedAt: '2026-09-12T00:00:00.000Z',
      nodeCounts: { total: 10_400, transcript: 9_900 },
      traceEvents: TRACE,
      samples: {
        pinnedCollapse: {
          before: { top: 1000, expanded: 'true' },
          after: { top: 1004, expanded: 'false' },
          frames: [
            { top: 1000, max: 1000, anchorTop: 300, anchorConnected: true },
            { top: 1004, max: 1004, anchorTop: 300, anchorConnected: true },
          ],
        },
        control: {
          before: { top: 200, expanded: 'true' },
          after: { top: 200, expanded: 'true' },
          frames: [{ top: 200, max: 900 }],
        },
      },
      quiescence: { waitedMs: 1200, quietMs: 750 },
    });

    expect(summary).toMatchObject({
      url: 'http://127.0.0.1:5173/workspace/w',
      scenario: 'footer',
      startedAt: '2026-09-12T00:00:00.000Z',
      nodeCounts: { total: 10_400, transcript: 9_900 },
      quiescence: { waitedMs: 1200, quietMs: 750 },
    });
    expect(Object.keys(summary.motions)).toEqual(['collapse', 'expand']);
    expect(summary.scroll.pinnedCollapse).toEqual({
      frames: 2,
      beforeTop: 1000,
      afterTop: 1004,
      maxBottomGap: 0,
      topRange: 4,
      anchorDriftPx: 0,
      anchorStayedConnected: true,
      toggled: true,
    });
    expect(summary.scroll.control).toMatchObject({ toggled: false, maxBottomGap: 700 });
  });
});
