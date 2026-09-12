import { spawnSync } from 'node:child_process';
import { pnpmInvocation } from './pnpm-launcher.mjs';

const TEST_FILE = 'src/features/agent/testing/reliability-stress-runner.test.ts';
const DEFAULT_SEEDS = ['1592639710', '1592639711', '1592639712'];

function parseList(value: string | undefined, fallback: string[]): string[] {
  return (value ?? fallback.join(','))
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

const seeds = parseList(process.env.AGENT_RELIABILITY_STRESS_SEEDS, DEFAULT_SEEDS);
const iterations = process.env.AGENT_RELIABILITY_STRESS_ITERATIONS ?? '1';
const failures: string[] = [];

console.log(
  `Running agent reliability stress matrix: seeds=${seeds.join(',')} iterations=${iterations}`,
);

for (const seed of seeds) {
  console.log(`\n--- stress seed=${seed} iterations=${iterations} ---`);
  const launcher = pnpmInvocation(['vitest', 'run', TEST_FILE]);
  const result = spawnSync(launcher.executable, launcher.args, {
    stdio: 'inherit',
    shell: launcher.shell,
    env: {
      ...process.env,
      AGENT_RELIABILITY_STRESS_SEED: seed,
      AGENT_RELIABILITY_STRESS_ITERATIONS: iterations,
    },
  });

  if (result.status !== 0) {
    failures.push(`seed=${seed} exit=${result.status ?? 'signal:' + result.signal}`);
  }
}

if (failures.length > 0) {
  console.error(`\nAgent reliability stress matrix failed:\n${failures.join('\n')}`);
  process.exit(1);
}

console.log('\nAgent reliability stress matrix passed.');
