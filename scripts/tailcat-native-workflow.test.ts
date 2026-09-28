// @verify-changed-triggers: .github/workflows/tailcat-native.yml
// @vitest-environment node

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

// Use the repository's existing workflow-parser route; no new dependency.
const builderRequire = createRequire(createRequire(import.meta.url).resolve('electron-builder'));
const { load } = createRequire(builderRequire.resolve('app-builder-lib'))('js-yaml');
const workflow = load(readFileSync('.github/workflows/tailcat-native.yml', 'utf8'));
const job = workflow.jobs['saved-tailcat'];
const candidate = 'c2b9afdb49403e222c9cd616fe63e887638d6abf';
const repository = 'intent-hq/cloudlands-fe';

function intendedEvent(action = 'synchronize') {
  return {
    event_name: 'pull_request',
    repository,
    event: {
      action,
      pull_request: {
        number: 2970,
        head: {
          sha: candidate,
          ref: 'fix/5583-native-tailcat-fixtures',
          repo: { full_name: repository },
        },
        base: { ref: 'main', repo: { full_name: repository } },
      },
    },
  };
}

function admitted(github: unknown) {
  // Evaluate the actual job condition, not a second implementation of it.
  // It uses only member access, equality and boolean operators, with concrete
  // string/number operands in these cases; no Actions functions or coercion.
  return runInNewContext(job.if, { github }, { timeout: 100 });
}

describe('historical Tailcat workflow admission', () => {
  it.each(['opened', 'synchronize', 'reopened'])(
    'admits the measured candidate for the configured %s event',
    (action) => {
      expect(workflow.on.pull_request.types).toContain(action);
      expect(admitted(intendedEvent(action))).toBe(true);
    },
  );

  it('skips an additional commit on the original branch before allocating the matrix', () => {
    const github = intendedEvent();
    github.event.pull_request.head.sha = 'a'.repeat(40);
    expect(admitted(github)).toBe(false);
  });

  it('skips a later PR even when it touches a matching backend path and reuses the head', () => {
    expect(workflow.on.pull_request.paths).toContain(
      'src/features/backend/main/backend-connection.test.ts',
    );
    const github = intendedEvent('opened');
    github.event.pull_request.number = 6191;
    expect(admitted(github)).toBe(false);
  });

  it('skips a fork with the same branch and candidate names', () => {
    const github = intendedEvent();
    github.event.pull_request.head.repo.full_name = 'someone/cloudlands-fe';
    expect(admitted(github)).toBe(false);
  });

  it('skips a copy of the workflow in a different repository', () => {
    const github = intendedEvent();
    github.repository = 'someone/cloudlands-fe';
    github.event.pull_request.head.repo.full_name = github.repository;
    github.event.pull_request.base.repo.full_name = github.repository;
    expect(admitted(github)).toBe(false);
  });

  it('skips another source branch at the same commit', () => {
    const github = intendedEvent();
    github.event.pull_request.head.ref = 'unrelated-backend-change';
    expect(admitted(github)).toBe(false);
  });

  it('skips a different base repository', () => {
    const github = intendedEvent();
    github.event.pull_request.base.repo.full_name = 'someone/cloudlands-fe';
    expect(admitted(github)).toBe(false);
  });

  it('skips another base branch', () => {
    const github = intendedEvent();
    github.event.pull_request.base.ref = 'release';
    expect(admitted(github)).toBe(false);
  });

  it('excludes unconfigured PR actions', () => {
    expect(workflow.on.pull_request.types).toEqual(['opened', 'synchronize', 'reopened']);
    expect(admitted(intendedEvent('closed'))).toBe(false);
  });

  it('does not admit another event without a pull request', () => {
    expect(admitted({ event_name: 'push', repository, event: {} })).toBe(false);
  });
});
