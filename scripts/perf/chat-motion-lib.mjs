import { mkdir } from 'node:fs/promises';
import path from 'node:path';

export const SCENARIOS = {
  footer: { marks: ['collapse', 'expand'] },
  'context-well': { marks: ['open', 'close'] },
};
const DEFAULT_WINDOW_MS = 400;
const FRAME_BUDGET_MS = 16.7;

const INTEGER_OPTIONS = {
  '--inflate': { key: 'inflate', min: 0 },
  '--frames': { key: 'frames', min: 1 },
  '--scroll-up': { key: 'scrollUp', min: 0 },
  '--quiet-ms': { key: 'quietMs', min: 0 },
  '--quiet-timeout': { key: 'quietTimeout', min: 1 },
  '--timeout': { key: 'timeout', min: 1 },
};

const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

function optionValue(argv, index, flag) {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

function integerOption(flag, value, { min, max = Number.MAX_SAFE_INTEGER }) {
  const parsed = value.trim() === '' ? Number.NaN : Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${flag} must be an integer from ${min} to ${max}.`);
  }
  return parsed;
}

function normalizeUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('--url must be a valid HTTP or HTTPS URL.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('--url must be a valid HTTP or HTTPS URL.');
  }
  return url.href;
}

export function parseArgs(argv) {
  const options = {
    scenario: 'footer',
    inflate: 10_000,
    frames: 40,
    scrollUp: 800,
    quietMs: 750,
    quietTimeout: 15_000,
    timeout: 180_000,
    headed: false,
  };
  const seen = new Set();

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (seen.has(flag)) throw new Error(`${flag} may only be specified once.`);
    seen.add(flag);
    if (flag === '--headed') {
      options.headed = true;
      continue;
    }
    if (flag === '--url') {
      options.url = normalizeUrl(optionValue(argv, index, flag));
    } else if (flag === '--out') {
      options.out = optionValue(argv, index, flag);
    } else if (flag === '--scenario') {
      const value = optionValue(argv, index, flag);
      if (!hasOwn(SCENARIOS, value)) {
        throw new Error(`--scenario must be one of: ${Object.keys(SCENARIOS).join(', ')}.`);
      }
      options.scenario = value;
    } else if (hasOwn(INTEGER_OPTIONS, flag)) {
      const { key, min } = INTEGER_OPTIONS[flag];
      options[key] = integerOption(flag, optionValue(argv, index, flag), { min });
    } else {
      throw new Error(`Unknown option: ${flag}`);
    }
    index += 1;
  }

  if (!options.url) throw new Error('--url is required.');
  if (!options.out) throw new Error('--out is required.');
  return options;
}

export async function prepareOutDir(outDir) {
  const resolved = path.resolve(outDir);
  await mkdir(path.dirname(resolved), { recursive: true });
  try {
    await mkdir(resolved);
  } catch (error) {
    if (error?.code === 'EEXIST') {
      throw new Error(`refusing to overwrite existing output directory ${resolved}`);
    }
    throw error;
  }
  return resolved;
}

const maxOf = (values) => values.reduce((max, value) => Math.max(max, value), 0);
const durationMs = (event) => (event.dur ?? 0) / 1000;

export function analyzeTrace(traceEvents, { marks, windowMs = DEFAULT_WINDOW_MS }) {
  const motions = {};
  const windowUs = windowMs * 1000;
  for (const mark of traceEvents.filter((event) => marks.includes(event.name))) {
    const window = traceEvents.filter(
      (event) =>
        event.pid === mark.pid &&
        event.tid === mark.tid &&
        (event.ts ?? 0) >= mark.ts &&
        (event.ts ?? 0) < mark.ts + windowUs,
    );
    const timing = (event) => ({
      offsetMs: (event.ts - mark.ts) / 1000,
      durationMs: durationMs(event),
    });
    const tasks = window.filter((event) => event.name === 'RunTask');
    const styles = window.filter((event) => event.name === 'UpdateLayoutTree');
    motions[mark.name] = {
      windowMs,
      taskCount: tasks.length,
      maxTaskMs: maxOf(tasks.map(durationMs)),
      tasksOver16_7: tasks.filter((event) => durationMs(event) > FRAME_BUDGET_MS).map(timing),
      maxUpdateLayoutTreeMs: maxOf(styles.map(durationMs)),
      maxUpdateLayoutTreeElements: maxOf(styles.map((event) => event.args?.elementCount ?? 0)),
      clicks: window
        .filter((event) => event.name === 'EventDispatch' && event.args?.data?.type === 'click')
        .map(timing),
      transitionFinishes: window
        .filter(
          (event) =>
            event.name === 'FunctionCall' &&
            event.args?.data?.functionName === 'animation.onfinish',
        )
        .map(timing),
    };
  }
  return motions;
}

export function analyzeSamples(frames) {
  const tops = frames.map((frame) => frame.top);
  const anchorTops = frames
    .map((frame) => frame.anchorTop)
    .filter((value) => typeof value === 'number');
  const hasAnchor = frames.some((frame) => frame.anchorConnected !== undefined);
  return {
    frames: frames.length,
    maxBottomGap: maxOf(frames.map((frame) => Math.abs(frame.max - frame.top))),
    topRange: tops.length ? Math.max(...tops) - Math.min(...tops) : 0,
    anchorDriftPx: anchorTops.length ? Math.max(...anchorTops) - Math.min(...anchorTops) : null,
    anchorStayedConnected: hasAnchor
      ? frames.every((frame) => frame.anchorConnected === true)
      : null,
  };
}

export function summarize({
  url,
  scenario,
  startedAt,
  nodeCounts,
  traceEvents,
  samples,
  quiescence,
  windowMs = DEFAULT_WINDOW_MS,
}) {
  const scroll = {};
  for (const [label, sample] of Object.entries(samples)) {
    scroll[label] = {
      ...analyzeSamples(sample.frames),
      beforeTop: sample.before.top,
      afterTop: sample.after.top,
      toggled: sample.before.expanded !== sample.after.expanded,
    };
  }
  return {
    url,
    scenario,
    startedAt,
    nodeCounts,
    motions: analyzeTrace(traceEvents, { marks: SCENARIOS[scenario].marks, windowMs }),
    scroll,
    quiescence: {
      preTraceWaitedMs: quiescence.preTraceWaitedMs,
      waitedMs: quiescence.waitedMs,
      quietMs: quiescence.quietMs,
    },
  };
}
