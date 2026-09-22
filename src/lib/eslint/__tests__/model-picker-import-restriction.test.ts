// @vitest-environment node
// @verify-changed-triggers: eslint.config.js, src/lib/components/chat/input/agent-model-mutator.ts
import { describe, expect, it } from 'vitest';
import { ESLint } from 'eslint';

const RULE_ID = 'no-restricted-imports';
const MODEL_PICKER = 'src/lib/components/chat/input/ModelPicker.svelte';
const NEIGHBOR_COMPONENT = 'src/lib/components/chat/input/EffortPicker.svelte';
const MUTATOR_MESSAGE = /agent-model-mutator/;

// `no-restricted-imports` compares import-source strings and never resolves
// modules, so a `paths`-only override bans just the alias spelling while the
// equivalent relative or extension-bearing import of the same file passes
// (cloudlands-fe#2763 review). Lint synthetic sources against the real
// eslint.config.js (vitest runs from the package root) so the matrix tracks
// the effective ModelPicker override, not the component's current imports.
const eslint = new ESLint({ cwd: process.cwd() });

function svelteSource(importStatement: string) {
  return `<script lang="ts">\n  ${importStatement}\n</script>\n\n<div></div>\n`;
}

async function restrictedImportMessages(importStatement: string, filePath = MODEL_PICKER) {
  const [result] = await eslint.lintText(svelteSource(importStatement), {
    filePath,
    warnIgnored: false,
  });
  return (result?.messages ?? []).filter((message) => message.ruleId === RULE_ID);
}

const AGENT_CLIENT_SPELLINGS = [
  '$features/agent/agent.client',
  '$features/agent/agent.client.ts',
  '$features/agent/agent.client.js',
  '../../../../features/agent/agent.client',
  '../../../../features/agent/agent.client.ts',
];

const REASONING_EFFORT_SPELLINGS = [
  '$features/agent/reasoning-effort',
  '$features/agent/reasoning-effort.ts',
  '../../../../features/agent/reasoning-effort',
  '../../../../features/agent/reasoning-effort.js',
];

const AGENT_SESSION_SLICE_SPELLINGS = [
  '$store/renderer/slices/agent-session/agent-session-slice',
  '$store/renderer/slices/agent-session/agent-session-slice.ts',
  '../../../../store/renderer/slices/agent-session/agent-session-slice',
  '../../../../store/renderer/slices/agent-session/agent-session-slice.js',
];

describe('ModelPicker mutation-module import restriction under the real eslint.config.js', () => {
  it('does not ignore ModelPicker.svelte', async () => {
    await expect(eslint.isPathIgnored(MODEL_PICKER)).resolves.toBe(false);
  });

  describe('forbids importing agentClient in every spelling', () => {
    it.each(AGENT_CLIENT_SPELLINGS)('%s', async (source) => {
      const messages = await restrictedImportMessages(`import { agentClient } from '${source}';`);
      expect(messages).toHaveLength(1);
      expect(messages[0].severity).toBe(2);
      expect(messages[0].message).toMatch(MUTATOR_MESSAGE);
    });
  });

  describe('forbids importing the reasoning-effort writers in every spelling', () => {
    it.each(REASONING_EFFORT_SPELLINGS)('%s', async (source) => {
      const messages = await restrictedImportMessages(
        `import { applyReasoningEffort } from '${source}';`,
      );
      expect(messages).toHaveLength(1);
      expect(messages[0].severity).toBe(2);
      expect(messages[0].message).toMatch(MUTATOR_MESSAGE);
    });
  });

  describe('forbids importing updateSession in every spelling', () => {
    it.each(AGENT_SESSION_SLICE_SPELLINGS)('%s', async (source) => {
      const messages = await restrictedImportMessages(`import { updateSession } from '${source}';`);
      expect(messages).toHaveLength(1);
      expect(messages[0].severity).toBe(2);
      expect(messages[0].message).toMatch(MUTATOR_MESSAGE);
    });
  });

  // Banning named exports alone leaves `import * as m` (then `m.agentClient`),
  // a default/side-effect import, or a non-mutating named export of the same
  // module open; each group bans the module as a whole.
  describe('forbids every import form of a restricted module, not just the mutating names', () => {
    it.each([
      ["import * as agentModule from '$features/agent/agent.client';", 'namespace'],
      ["import '$features/agent/agent.client';", 'side-effect'],
      ["import agentDefault from '$features/agent/agent.client';", 'default'],
      ["import type { AgentClient } from '$features/agent/agent.client';", 'type'],
      [
        "import * as sessionSlice from '$store/renderer/slices/agent-session/agent-session-slice';",
        'namespace (slice)',
      ],
      ["import '$store/renderer/slices/agent-session/agent-session-slice';", 'side-effect (slice)'],
      [
        "import { selectAgentSession } from '$store/renderer/slices/agent-session/agent-session-slice';",
        'non-mutating named export (slice)',
      ],
      [
        "import * as effort from '../../../../features/agent/reasoning-effort';",
        'namespace (relative)',
      ],
    ])('%s (%s)', async (importStatement) => {
      const messages = await restrictedImportMessages(importStatement);
      expect(messages).toHaveLength(1);
      expect(messages[0].severity).toBe(2);
      expect(messages[0].message).toMatch(MUTATOR_MESSAGE);
    });
  });

  it('allows the lock-checking mutator itself', async () => {
    await expect(
      restrictedImportMessages(
        "import { createAgentModelMutator, isSkippedMutation } from './agent-model-mutator';",
      ),
    ).resolves.toEqual([]);
  });

  it('keeps the shared CT-module restriction in the ModelPicker override', async () => {
    const messages = await restrictedImportMessages(
      "import { test } from '@playwright/experimental-ct-svelte';",
    );
    expect(messages).toHaveLength(1);
    expect(messages[0].message).toMatch(/src\/test\/ct-test\.ts/);
  });

  it('does not apply the mutator restriction to a neighboring component', async () => {
    await expect(
      restrictedImportMessages(
        "import { agentClient } from '$features/agent/agent.client';",
        NEIGHBOR_COMPONENT,
      ),
    ).resolves.toEqual([]);
  });
});
