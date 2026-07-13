#!/usr/bin/env tsx
/**
 * Remote Environment Test Runner
 *
 * Orchestrates running tests against mock remote environments.
 * Can check if containers are running before tests.
 */

import { spawn } from 'child_process';
import * as net from 'net';
import { ALL_PROFILES, RemoteEnvProfile } from './remote-env-config';

/** Check if a port is open */
async function isPortOpen(host: string, port: number, timeout = 2000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();

    socket.setTimeout(timeout);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('error', () => {
      socket.destroy();
      resolve(false);
    });

    socket.connect(port, host);
  });
}

/** Check if a profile's remote environment is running */
async function isProfileRunning(profile: RemoteEnvProfile): Promise<boolean> {
  return isPortOpen(profile.host, profile.port);
}

/** Get which profiles are currently running */
async function getRunningProfiles(): Promise<RemoteEnvProfile[]> {
  const results = await Promise.all(
    ALL_PROFILES.map(async (p) => ({
      profile: p,
      running: await isProfileRunning(p),
    })),
  );
  return results.filter((r) => r.running).map((r) => r.profile);
}

/** Run vitest for a specific profile */
async function runTestsForProfile(profile: RemoteEnvProfile): Promise<boolean> {
  console.log(`\n🧪 Running tests for profile: ${profile.name}`);
  console.log(`   Host: ${profile.host}:${profile.port}`);
  console.log(`   User: ${profile.username}`);
  console.log('');

  return new Promise((resolve) => {
    const child = spawn(
      'npx',
      ['vitest', 'run', 'test/remote-env/*.ts', '--reporter=verbose'],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          REMOTE_ENV_PROFILE: profile.name,
        },
        stdio: 'inherit',
      },
    );

    child.on('close', (code) => {
      resolve(code === 0);
    });
  });
}

async function main() {
  const args = process.argv.slice(2);
  const profileArg = args.find((a) => a.startsWith('--profile='))?.split('=')[1];
  const checkOnly = args.includes('--check');
  const startIfNeeded = args.includes('--start');

  console.log('🔍 Remote Environment Test Runner');
  console.log('================================\n');

  // Check running profiles
  const running = await getRunningProfiles();

  console.log('Running environments:');
  if (running.length === 0) {
    console.log('  (none)\n');

    if (!startIfNeeded) {
      console.log('No remote environments running.');
      console.log('Start them with: npm run remote-env:start');
      console.log('Or run with --start to auto-start.\n');
      process.exit(1);
    }
  } else {
    for (const p of running) {
      console.log(`  ✅ ${p.name} (${p.host}:${p.port})`);
    }
    console.log('');
  }

  if (checkOnly) {
    process.exit(running.length > 0 ? 0 : 1);
  }

  // Determine which profiles to test
  let profilesToTest: RemoteEnvProfile[];

  if (profileArg) {
    const profile = ALL_PROFILES.find((p) => p.name === profileArg);
    if (!profile) {
      console.error(`Unknown profile: ${profileArg}`);
      process.exit(1);
    }
    profilesToTest = [profile];
  } else {
    profilesToTest = running;
  }

  if (profilesToTest.length === 0) {
    console.error('No profiles to test');
    process.exit(1);
  }

  // Run tests
  const results: { profile: string; passed: boolean }[] = [];

  for (const profile of profilesToTest) {
    const passed = await runTestsForProfile(profile);
    results.push({ profile: profile.name, passed });
  }

  // Summary
  console.log('\n📊 Test Summary');
  console.log('===============');
  for (const r of results) {
    console.log(`  ${r.passed ? '✅' : '❌'} ${r.profile}`);
  }

  const allPassed = results.every((r) => r.passed);
  process.exit(allPassed ? 0 : 1);
}

main().catch((e) => {
  console.error('Error:', e);
  process.exit(1);
});
