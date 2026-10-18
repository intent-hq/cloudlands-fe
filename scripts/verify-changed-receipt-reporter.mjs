// Vitest reporter used by `verify:changed` unit lanes. It appends one line per
// finished test file as soon as that file settles, so an interrupted run still
// records every file that completed. Inactive unless the runner sets the env.
import { appendFileSync } from 'node:fs';
import { relative, sep } from 'node:path';
import { CONFIG_ENV, INVOCATION_ENV, LANE_ENV, RESULTS_ENV } from './verify-changed-receipts.mjs';

export default class VerifyChangedReceiptReporter {
  constructor() {
    this.path = process.env[RESULTS_ENV];
    this.common = {
      lane: process.env[LANE_ENV] ?? null,
      invocation: process.env[INVOCATION_ENV] ?? null,
      config: process.env[CONFIG_ENV] ?? null,
    };
  }

  write(record) {
    if (!this.path) return;
    appendFileSync(
      this.path,
      `${JSON.stringify({ at: new Date().toISOString(), ...this.common, ...record })}\n`,
    );
  }

  onTestModuleEnd(testModule) {
    const file = relative(process.cwd(), testModule.moduleId).split(sep).join('/');
    this.write({ type: 'unit-file', file, state: testModule.state() });
  }

  onTestRunEnd(_testModules, unhandledErrors, reason) {
    this.write({ type: 'unit-run-end', reason, unhandledErrors: unhandledErrors.length });
  }
}
