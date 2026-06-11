#!/usr/bin/env node

import CDP from 'chrome-remote-interface';

const DEFAULT_PORT = Number(process.env.CDP_PORT || 9223);
const DEFAULT_HOST = process.env.CDP_HOST || '127.0.0.1';

function usage() {
  console.log(`Observe renderer heap metrics through Electron CDP.

Usage:
  pnpm observe:memory -- --list-targets
  pnpm observe:memory -- --count 3 --interval 1000
  CDP_PORT=9224 pnpm observe:memory -- --count 1

Options:
  --host <host>       CDP host (default: ${DEFAULT_HOST})
  --port <port>       CDP port (default: CDP_PORT or ${DEFAULT_PORT})
  --count <n>         Number of samples before exit (default: 1)
  --interval <ms>     Delay between samples (default: 1000)
  --follow            Keep sampling until stopped
  --list-targets      Print CDP targets and exit
  --json              Print samples as JSON lines
  --help              Show this help

Start the app with CDP first: pnpm dev:cdp. The target list should be at
http://127.0.0.1:<port>/json/list. For agent-browser, connect to the same port.`);
}

function parseArgs(argv) {
  const options = {
    host: DEFAULT_HOST,
    port: DEFAULT_PORT,
    count: 1,
    interval: 1000,
    follow: false,
    listTargets: false,
    json: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const readValue = () => argv[++i];
    if (arg === '--') continue;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--host') options.host = readValue() || options.host;
    else if (arg === '--port') options.port = Number(readValue() || options.port);
    else if (arg === '--count' || arg === '-n') options.count = Number(readValue() || options.count);
    else if (arg === '--interval') options.interval = Number(readValue() || options.interval);
    else if (arg === '--follow' || arg === '-f') options.follow = true;
    else if (arg === '--list-targets') options.listTargets = true;
    else if (arg === '--json') options.json = true;
    else throw new Error(`Unknown option: ${arg}`);
  }

  if (!Number.isFinite(options.port) || options.port <= 0) throw new Error('Invalid --port');
  if (!Number.isFinite(options.count) || options.count <= 0) throw new Error('Invalid --count');
  if (!Number.isFinite(options.interval) || options.interval <= 0) throw new Error('Invalid --interval');
  return options;
}

async function fetchTargets({ host, port }) {
  const response = await fetch(`http://${host}:${port}/json/list`);
  if (!response.ok) throw new Error(`CDP target list returned HTTP ${response.status}`);
  return response.json();
}

function targetLabel(target) {
  const title = target.title || '(untitled)';
  const url = target.url || '(no url)';
  return `${target.type || 'unknown'} ${target.id || ''} ${title} ${url}`;
}

function pickRendererTarget(targets) {
  return targets.find((target) => ['page', 'webview'].includes(target.type)) || targets[0];
}

function metricValue(metrics, name) {
  return metrics.find((metric) => metric.name === name)?.value;
}

function mb(value) {
  return value == null ? undefined : Number((value / 1024 / 1024).toFixed(2));
}

async function sampleTarget(options, target) {
  const client = await CDP({ host: options.host, port: options.port, target: target.id });
  try {
    await Promise.all([
      client.Performance.enable(),
      client.Runtime.enable().catch(() => null),
    ]);
    const [performance, heapUsage] = await Promise.all([
      client.Performance.getMetrics(),
      client.Runtime.getHeapUsage().catch(() => null),
    ]);
    const metrics = performance.metrics || [];
    return {
      ts: new Date().toISOString(),
      targetId: target.id,
      targetType: target.type,
      title: target.title,
      url: target.url,
      jsHeapUsedMB: mb(metricValue(metrics, 'JSHeapUsedSize')),
      jsHeapTotalMB: mb(metricValue(metrics, 'JSHeapTotalSize')),
      runtimeUsedMB: mb(heapUsage?.usedSize),
      runtimeTotalMB: mb(heapUsage?.totalSize),
      nodes: metricValue(metrics, 'Nodes'),
      documents: metricValue(metrics, 'Documents'),
      listeners: metricValue(metrics, 'JSEventListeners'),
    };
  } finally {
    await client.close();
  }
}

function printSample(sample, json) {
  if (json) {
    console.log(JSON.stringify(sample));
    return;
  }
  console.log(
    `${sample.ts} heap=${sample.jsHeapUsedMB ?? 'n/a'}/${sample.jsHeapTotalMB ?? 'n/a'}MB ` +
      `runtime=${sample.runtimeUsedMB ?? 'n/a'}/${sample.runtimeTotalMB ?? 'n/a'}MB ` +
      `nodes=${sample.nodes ?? 'n/a'} docs=${sample.documents ?? 'n/a'} listeners=${sample.listeners ?? 'n/a'} ` +
      `target=${sample.targetType}:${sample.title || sample.targetId}`,
  );
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    usage();
    return;
  }

  const targets = await fetchTargets(options);
  if (options.listTargets) {
    console.log(`CDP targets at http://${options.host}:${options.port}/json/list:`);
    targets.forEach((target, index) => console.log(`${index + 1}. ${targetLabel(target)}`));
    if (targets.length === 0) console.log('(none)');
    return;
  }

  const target = pickRendererTarget(targets);
  if (!target) throw new Error('No CDP targets found. Start the app with `pnpm dev:cdp`.');

  const limit = options.follow ? Number.POSITIVE_INFINITY : options.count;
  for (let i = 0; i < limit; i++) {
    printSample(await sampleTarget(options, target), options.json);
    if (i + 1 < limit) await new Promise((resolve) => setTimeout(resolve, options.interval));
  }
}

main().catch((error) => {
  console.error(`observe:memory failed: ${error.message}`);
  console.error(`Start CDP with \`pnpm dev:cdp\`, then retry with \`pnpm observe:memory -- --port ${DEFAULT_PORT}\`.`);
  process.exit(1);
});