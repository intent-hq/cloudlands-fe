/**
 * Specialist File Loader Unit Tests
 *
 * Tests for edge cases in specialist file parsing, including:
 * - Empty files/content
 * - Malformed YAML frontmatter
 * - Missing required fields
 * - Invalid field values
 * - Unicode and special characters
 * - YAML block scalars (| and >)
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  beforeAll,
  afterAll,
  afterEach,
} from 'vitest';
import {
  parseSpecialistFile,
  parseModelOptionsScalar,
  parseRoleScalar,
  parseTeamAgentsScalar,
  splitCompoundModelScalar,
  writeSpecialistFile,
  loadSpecialistFile,
  loadProjectSpecialistFiles,
  getProjectSpecialistsDirectory,
} from '../specialist-file-loader';
import {
  generateUniqueSpecialistId,
  sanitizeSpecialistId,
} from '../../../../shared/specialist-file-types';

const TEST_HOME = '/tmp/augment-specialist-file-loader-test';
let originalHome: string | undefined;

// Mock electron app
vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp/test-augment',
    isPackaged: false,
  },
}));

beforeAll(async () => {
  originalHome = process.env.HOME;
  process.env.HOME = TEST_HOME;
  await fs.rm(TEST_HOME, { recursive: true, force: true });
});

beforeEach(async () => {
  await fs.rm(TEST_HOME, { recursive: true, force: true });
});

afterAll(async () => {
  await fs.rm(TEST_HOME, { recursive: true, force: true });
  if (originalHome === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = originalHome;
  }
});

describe('parseSpecialistFile', () => {
  describe('Valid files', () => {
    it('should parse a valid specialist file', () => {
      const content = `---
name: "Test Specialist"
description: "A test specialist"
codingAgent: "codex"
---

You are a test specialist.`;

      const result = parseSpecialistFile('/path/to/test-specialist.md', content);
      expect('error' in result).toBe(false);
      if (!('error' in result)) {
        expect(result.id).toBe('test-specialist');
        expect(result.frontmatter.name).toBe('Test Specialist');
        expect(result.frontmatter.description).toBe('A test specialist');
        expect(result.frontmatter.codingAgent).toBe('codex');
        expect(result.behaviorPrompt).toBe('You are a test specialist.');
      }
    });

    it('should handle empty body', () => {
      const content = `---
name: "Empty Body"
description: "A specialist with no body"
---
`;

      const result = parseSpecialistFile('/path/to/empty-body.md', content);
      expect('error' in result).toBe(false);
      if (!('error' in result)) {
        expect(result.behaviorPrompt).toBe('');
      }
    });

    it('should parse unquoted string values', () => {
      const content = `---
name: Unquoted Name
description: Unquoted description
---

Body content`;

      const result = parseSpecialistFile('/path/to/unquoted.md', content);
      expect('error' in result).toBe(false);
      if (!('error' in result)) {
        expect(result.frontmatter.name).toBe('Unquoted Name');
      }
    });
  });

  describe('Missing optional fields', () => {
    it('should derive name from filename when name is missing', () => {
      const content = `---
description: "A specialist"
---

Body`;

      const result = parseSpecialistFile('/path/to/missing-name.md', content);
      expect('error' in result).toBe(false);
      if (!('error' in result)) {
        expect(result.frontmatter.name).toBe('missing-name');
        expect(result.frontmatter.description).toBe('A specialist');
        expect(result.behaviorPrompt).toBe('Body');
      }
    });

    it('should use empty description when description is missing', () => {
      const content = `---
name: "Test"
---

Body`;

      const result = parseSpecialistFile('/path/to/missing-desc.md', content);
      expect('error' in result).toBe(false);
      if (!('error' in result)) {
        expect(result.frontmatter.name).toBe('Test');
        expect(result.frontmatter.description).toBe('');
        expect(result.behaviorPrompt).toBe('Body');
      }
    });
  });

  describe('Retired modelTier key', () => {
    it('should tolerate and ignore a modelTier key in existing files', () => {
      for (const tier of ['fast', 'balanced', 'smart', 'invalid']) {
        const content = `---
name: "Test"
description: "A test"
modelTier: "${tier}"
---

Body`;

        const result = parseSpecialistFile(`/path/to/${tier}.md`, content);
        expect('error' in result).toBe(false);
        if (!('error' in result)) {
          expect('modelTier' in result.frontmatter).toBe(false);
        }
      }
    });
  });

  describe('Malformed frontmatter', () => {
    it('should handle no frontmatter by using entire content as behaviorPrompt', () => {
      const content = `Just some content without frontmatter`;

      const result = parseSpecialistFile('/path/to/no-fm.md', content);
      expect('error' in result).toBe(false);
      if (!('error' in result)) {
        expect(result.id).toBe('no-fm');
        expect(result.frontmatter.name).toBe('no-fm');
        expect(result.frontmatter.description).toBe('');
        expect(result.behaviorPrompt).toBe('Just some content without frontmatter');
      }
    });

    it('should handle missing closing --- as content without frontmatter', () => {
      const content = `---
name: "Test"
description: "A test"

Body content`;

      const result = parseSpecialistFile('/path/to/no-close.md', content);
      expect('error' in result).toBe(false);
      if (!('error' in result)) {
        expect(result.frontmatter.name).toBe('no-close');
        expect(result.behaviorPrompt).toContain('name: "Test"');
      }
    });

    it('should handle empty file as specialist with empty behaviorPrompt', () => {
      const result = parseSpecialistFile('/path/to/empty.md', '');
      expect('error' in result).toBe(false);
      if (!('error' in result)) {
        expect(result.frontmatter.name).toBe('empty');
        expect(result.frontmatter.description).toBe('');
        expect(result.behaviorPrompt).toBe('');
      }
    });

    it('should handle only opening --- as content without frontmatter', () => {
      const content = `---`;

      const result = parseSpecialistFile('/path/to/only-open.md', content);
      expect('error' in result).toBe(false);
      if (!('error' in result)) {
        expect(result.frontmatter.name).toBe('only-open');
        expect(result.behaviorPrompt).toBe('---');
      }
    });
  });

  describe('Unicode and special characters', () => {
    it('should handle unicode in name', () => {
      const content = `---
name: "测试 Specialist 🚀"
description: "A test with unicode"
---

Body`;

      const result = parseSpecialistFile('/path/to/unicode.md', content);
      expect('error' in result).toBe(false);
      if (!('error' in result)) {
        expect(result.frontmatter.name).toBe('测试 Specialist 🚀');
      }
    });

    it('should handle colons in values', () => {
      const content = `---
name: "Test: With Colon"
description: "Description: has colons: everywhere"
---

Body`;

      const result = parseSpecialistFile('/path/to/colons.md', content);
      expect('error' in result).toBe(false);
      if (!('error' in result)) {
        expect(result.frontmatter.name).toBe('Test: With Colon');
      }
    });

    it('should unescape escape sequences in double-quoted values', () => {
      const content = `---
name: "Quote \\" Backslash \\\\ Newline \\n Tab \\t"
description: "A test"
---

Body`;

      const result = parseSpecialistFile('/path/to/escapes.md', content);
      expect('error' in result).toBe(false);
      if (!('error' in result)) {
        expect(result.frontmatter.name).toBe('Quote " Backslash \\ Newline \n Tab \t');
      }
    });

    it('should not double-unescape backslash sequences', () => {
      // \\n in the source is an escaped backslash followed by "n" — it must
      // unescape to a literal backslash + n, never to a newline.
      const content = `---
name: "literal \\\\n stays"
description: "A test"
---

Body`;

      const result = parseSpecialistFile('/path/to/double-escape.md', content);
      expect('error' in result).toBe(false);
      if (!('error' in result)) {
        expect(result.frontmatter.name).toBe('literal \\n stays');
      }
    });
  });

  describe('YAML block scalars', () => {
    it('should handle literal block scalar (|)', () => {
      const content = `---
name: "Test"
description: "A test"
roleReminder: |
  Line 1
  Line 2
  Line 3
---

Body`;

      const result = parseSpecialistFile('/path/to/literal.md', content);
      expect('error' in result).toBe(false);
      if (!('error' in result)) {
        expect(result.frontmatter.roleReminder).toContain('Line 1');
        expect(result.frontmatter.roleReminder).toContain('Line 2');
      }
    });
  });

  describe('Windows line endings', () => {
    it('should handle CRLF line endings', () => {
      const content = "---\r\nname: \"Test\"\r\ndescription: \"A test\"\r\n---\r\n\r\nBody content";

      const result = parseSpecialistFile('/path/to/crlf.md', content);
      expect('error' in result).toBe(false);
      if (!('error' in result)) {
        expect(result.frontmatter.name).toBe('Test');
        expect(result.behaviorPrompt).toBe('Body content');
      }
    });
  });

  describe('ID extraction from filename', () => {
    it('should extract ID from simple filename', () => {
      const content = `---
name: "Test"
description: "A test"
---

Body`;

      const result = parseSpecialistFile('/path/to/my-specialist.md', content);
      expect('error' in result).toBe(false);
      if (!('error' in result)) {
        expect(result.id).toBe('my-specialist');
      }
    });

    it('should handle nested paths', () => {
      const content = `---
name: "Test"
description: "A test"
---

Body`;

      const result = parseSpecialistFile('/deep/nested/path/specialist-name.md', content);
      expect('error' in result).toBe(false);
      if (!('error' in result)) {
        expect(result.id).toBe('specialist-name');
      }
    });
  });

  describe('Large files', () => {
    it('should handle large body content', () => {
      const largeBody = 'X'.repeat(100000); // 100KB of content
      const content = `---
name: "Large Specialist"
description: "A specialist with large body"
---

${largeBody}`;

      const result = parseSpecialistFile('/path/to/large.md', content);
      expect('error' in result).toBe(false);
      if (!('error' in result)) {
        expect(result.behaviorPrompt.length).toBeGreaterThan(90000);
      }
    });

    it('should handle large roleReminder using block scalar', () => {
      const largeReminder = 'Never do X. '.repeat(1000);
      const content = `---
name: "Test"
description: "A test"
roleReminder: |
  ${largeReminder}
---

Body`;

      const result = parseSpecialistFile('/path/to/large-reminder.md', content);
      expect('error' in result).toBe(false);
      if (!('error' in result)) {
        expect(result.frontmatter.roleReminder).toBeDefined();
        expect(result.frontmatter.roleReminder!.length).toBeGreaterThan(5000);
      }
    });
  });

  describe('Source parameter', () => {
    it('should set source to user by default', () => {
      const content = `---
name: "Test"
description: "A test"
---

Body`;

      const result = parseSpecialistFile('/path/to/test.md', content);
      expect('error' in result).toBe(false);
      if (!('error' in result)) {
        expect(result.source).toBe('user');
      }
    });

    it('should respect project source', () => {
      const content = `---
name: "Test"
description: "A test"
---

Body`;

      const result = parseSpecialistFile('/path/to/test.md', content, 'project');
      expect('error' in result).toBe(false);
      if (!('error' in result)) {
        expect(result.source).toBe('project');
      }
    });

    it('should respect bundled source', () => {
      const content = `---
name: "Test"
description: "A test"
---

Body`;

      const result = parseSpecialistFile('/path/to/test.md', content, 'bundled');
      expect('error' in result).toBe(false);
      if (!('error' in result)) {
        expect(result.source).toBe('bundled');
      }
    });
  });

  describe('modelOptions frontmatter scalar (PROTOCOL §5.11 lenient reads)', () => {
    it('should parse a valid single-line JSON-array scalar', () => {
      const content = `---
name: "With Options"
description: "Has model options"
modelOptions: [{"provider":"opencode","model":"kimi-k3","hint":"cheap"},{"model":"opus4.5","hint":""}]
---

Prompt.`;

      const result = parseSpecialistFile('/path/to/with-options.md', content);
      expect('error' in result).toBe(false);
      if (!('error' in result)) {
        expect(result.frontmatter.modelOptions).toEqual([
          { provider: 'opencode', model: 'kimi-k3', hint: 'cheap' },
          { model: 'opus4.5', hint: '' },
        ]);
      }
    });

    it('should split legacy compound model ids into provider + bare model', () => {
      expect(
        parseModelOptionsScalar('[{"model":"opencode:kimi-k3","hint":"cheap"}]'),
      ).toEqual([{ provider: 'opencode', model: 'kimi-k3', hint: 'cheap' }]);
      // The compound prefix wins over an entry-level provider field.
      expect(
        parseModelOptionsScalar('[{"provider":"auggie","model":"opencode:kimi-k3","hint":""}]'),
      ).toEqual([{ provider: 'opencode', model: 'kimi-k3', hint: '' }]);
      // Both halves are trimmed.
      expect(parseModelOptionsScalar('[{"model":" opencode : kimi-k3 ","hint":""}]')).toEqual([
        { provider: 'opencode', model: 'kimi-k3', hint: '' },
      ]);
    });

    it('should treat a compound id with an empty prefix or rest as unusable', () => {
      expect(parseModelOptionsScalar('[{"model":":kimi-k3","hint":""}]')).toBeUndefined();
      expect(parseModelOptionsScalar('[{"model":"opencode:","hint":""}]')).toBeUndefined();
      expect(parseModelOptionsScalar('[{"model":" : ","hint":""}]')).toBeUndefined();
    });

    it('should carry provider only when it is a non-empty string', () => {
      expect(parseModelOptionsScalar('[{"provider":"","model":"opus4.5","hint":""}]')).toEqual([
        { model: 'opus4.5', hint: '' },
      ]);
      expect(parseModelOptionsScalar('[{"provider":"  ","model":"opus4.5","hint":""}]')).toEqual([
        { model: 'opus4.5', hint: '' },
      ]);
      expect(parseModelOptionsScalar('[{"provider":42,"model":"opus4.5","hint":""}]')).toEqual([
        { model: 'opus4.5', hint: '' },
      ]);
    });

    it('should treat an unparseable scalar as an omitted key', () => {
      expect(parseModelOptionsScalar('not json')).toBeUndefined();
      expect(parseModelOptionsScalar('{"model":"a"}')).toBeUndefined();
      expect(parseModelOptionsScalar(undefined)).toBeUndefined();
      expect(parseModelOptionsScalar('')).toBeUndefined();
    });

    it('should keep a literal [] as an explicit clear', () => {
      expect(parseModelOptionsScalar('[]')).toEqual([]);
    });

    it('should skip unusable entries individually and default hint to ""', () => {
      expect(
        parseModelOptionsScalar(
          '[{"model":"good"},"junk",{"hint":"no model"},{"model":""},{"model":"ok","hint":42}]',
        ),
      ).toEqual([
        { model: 'good', hint: '' },
        { model: 'ok', hint: '' },
      ]);
    });

    it('should read a whitespace-only model or reasoningEffort as unusable/omitted', () => {
      expect(parseModelOptionsScalar('[{"model":"  ","hint":""}]')).toBeUndefined();
      expect(
        parseModelOptionsScalar('[{"model":"opus4.5","hint":"","reasoningEffort":"  "}]'),
      ).toEqual([{ model: 'opus4.5', hint: '' }]);
    });

    it('should treat a non-empty array of all-unusable entries as omitted (inherits)', () => {
      expect(parseModelOptionsScalar('[{"hint":"no model"},"junk"]')).toBeUndefined();
    });
  });

  describe('legacy compound model frontmatter scalar (PROTOCOL §5.11 lenient reads)', () => {
    it('should split a compound model into bare model + codingAgent, the prefix winning', () => {
      expect(splitCompoundModelScalar('opencode:kimi-k3', undefined)).toEqual({
        model: 'kimi-k3',
        codingAgent: 'opencode',
      });
      expect(splitCompoundModelScalar('opencode:kimi-k3', 'auggie')).toEqual({
        model: 'kimi-k3',
        codingAgent: 'opencode',
      });
      expect(splitCompoundModelScalar(' opencode : kimi-k3 ', undefined)).toEqual({
        model: 'kimi-k3',
        codingAgent: 'opencode',
      });
    });

    it('should pass bare models through untouched', () => {
      expect(splitCompoundModelScalar('opus4.5', 'auggie')).toEqual({
        model: 'opus4.5',
        codingAgent: 'auggie',
      });
      expect(splitCompoundModelScalar(undefined, 'auggie')).toEqual({
        model: undefined,
        codingAgent: 'auggie',
      });
    });

    it('should read a compound with an empty prefix or rest as an omitted model', () => {
      expect(splitCompoundModelScalar(':kimi-k3', 'auggie')).toEqual({
        model: undefined,
        codingAgent: 'auggie',
      });
      expect(splitCompoundModelScalar('opencode:', 'auggie')).toEqual({
        model: undefined,
        codingAgent: 'auggie',
      });
    });

    it('should apply the split when parsing a specialist file', () => {
      const content = `---
name: "Legacy"
description: "Compound model id"
codingAgent: "auggie"
model: "opencode:kimi-k3"
---

Prompt.`;

      const result = parseSpecialistFile('/path/to/legacy.md', content);
      expect('error' in result).toBe(false);
      if (!('error' in result)) {
        expect(result.frontmatter.model).toBe('kimi-k3');
        expect(result.frontmatter.codingAgent).toBe('opencode');
      }
    });
  });

  describe('role/teamAgents/icon frontmatter (PROTOCOL §5.11 lenient reads)', () => {
    it('should parse known role values and the icon scalar', () => {
      const content = `---
name: "Orchestrator"
description: "Coordinates"
role: "orchestrator"
teamAgents: ["implementor","verifier"]
icon: "coordinator"
---

Prompt.`;

      const result = parseSpecialistFile('/path/to/orchestrator.md', content);
      expect('error' in result).toBe(false);
      if (!('error' in result)) {
        expect(result.frontmatter.role).toBe('orchestrator');
        expect(result.frontmatter.teamAgents).toEqual(['implementor', 'verifier']);
        expect(result.frontmatter.icon).toBe('coordinator');
      }
    });

    it('should read unknown role values as an omitted key (never rejects)', () => {
      expect(parseRoleScalar('orchestrator')).toBe('orchestrator');
      expect(parseRoleScalar('internal')).toBe('internal');
      expect(parseRoleScalar('sidekick')).toBeUndefined();
      expect(parseRoleScalar('')).toBeUndefined();
      expect(parseRoleScalar(undefined)).toBeUndefined();
    });

    it('should apply modelOptions-style lenient reads to teamAgents', () => {
      expect(parseTeamAgentsScalar('["a","b"]')).toEqual(['a', 'b']);
      expect(parseTeamAgentsScalar('[]')).toEqual([]);
      expect(parseTeamAgentsScalar('not json')).toBeUndefined();
      expect(parseTeamAgentsScalar('{"a":1}')).toBeUndefined();
      expect(parseTeamAgentsScalar('["good","",42]')).toEqual(['good']);
      expect(parseTeamAgentsScalar('["",42]')).toBeUndefined();
      expect(parseTeamAgentsScalar('["good"," "]')).toEqual(['good']);
      expect(parseTeamAgentsScalar('[" "]')).toBeUndefined();
      expect(parseTeamAgentsScalar(undefined)).toBeUndefined();
      expect(parseTeamAgentsScalar('')).toBeUndefined();
    });

    it('should leave role/teamAgents/icon undefined when absent', () => {
      const content = `---
name: "Plain"
description: "No metadata"
---

Prompt.`;

      const result = parseSpecialistFile('/path/to/plain.md', content);
      expect('error' in result).toBe(false);
      if (!('error' in result)) {
        expect(result.frontmatter.role).toBeUndefined();
        expect(result.frontmatter.teamAgents).toBeUndefined();
        expect(result.frontmatter.icon).toBeUndefined();
      }
    });
  });

  describe('Persistence and migration', () => {
    it('should round-trip codingAgent when writing and loading a specialist file', async () => {
      await writeSpecialistFile({
        id: 'round-trip',
        name: 'Round Trip',
        description: 'Round-trip test specialist',
        codingAgent: 'codex',
        roleReminder: 'Stay focused.',
        behaviorPrompt: 'Round-trip prompt',
      });

      const loaded = await loadSpecialistFile('round-trip');

      expect(loaded).not.toBeNull();
      expect(loaded?.frontmatter.codingAgent).toBe('codex');
      expect(loaded?.frontmatter.roleReminder).toBe('Stay focused.');
      expect(loaded?.behaviorPrompt).toBe('Round-trip prompt');
    });

    it('should round-trip hidden when writing and loading a specialist file', async () => {
      await writeSpecialistFile({
        id: 'hidden-round-trip',
        name: 'Hidden Round Trip',
        description: 'Hidden round-trip test specialist',
        hidden: true,
        behaviorPrompt: 'Hidden prompt',
      });

      const loaded = await loadSpecialistFile('hidden-round-trip');

      expect(loaded).not.toBeNull();
      expect(loaded?.frontmatter.hidden).toBe(true);
    });

    it('should omit hidden frontmatter when hidden is not set', async () => {
      await writeSpecialistFile({
        id: 'visible-round-trip',
        name: 'Visible Round Trip',
        description: 'Visible round-trip test specialist',
        behaviorPrompt: 'Visible prompt',
      });

      const loaded = await loadSpecialistFile('visible-round-trip');

      expect(loaded).not.toBeNull();
      expect(loaded?.rawContent).not.toContain('hidden:');
      expect(loaded?.frontmatter.hidden).toBeUndefined();
    });

    it('should round-trip modelOptions when writing and loading a specialist file', async () => {
      const modelOptions = [
        { provider: 'opencode', model: 'kimi-k3', hint: 'cheap' },
        { model: 'opus4.5', hint: '' },
      ];
      await writeSpecialistFile({
        id: 'options-round-trip',
        name: 'Options Round Trip',
        description: 'Model options round-trip test specialist',
        modelOptions,
        behaviorPrompt: 'Options prompt',
      });

      const loaded = await loadSpecialistFile('options-round-trip');

      expect(loaded).not.toBeNull();
      expect(loaded?.rawContent).toContain(`modelOptions: ${JSON.stringify(modelOptions)}`);
      expect(loaded?.frontmatter.modelOptions).toEqual(modelOptions);
    });

    it('should normalize legacy compound entries to the triple shape on write', async () => {
      await writeSpecialistFile({
        id: 'options-compound-write',
        name: 'Options Compound Write',
        description: 'Legacy compound entry normalization',
        model: 'opencode:kimi-k3',
        codingAgent: 'auggie',
        modelOptions: [{ provider: 'auggie', model: 'opencode:kimi-k3', hint: 'cheap' }],
        behaviorPrompt: 'Prompt',
      });

      const loaded = await loadSpecialistFile('options-compound-write');
      expect(loaded?.rawContent).toContain(
        `modelOptions: ${JSON.stringify([{ provider: 'opencode', model: 'kimi-k3', hint: 'cheap' }])}`,
      );
      expect(loaded?.rawContent).toContain('model: "kimi-k3"');
      expect(loaded?.rawContent).toContain('codingAgent: "opencode"');
      expect(loaded?.frontmatter.modelOptions).toEqual([
        { provider: 'opencode', model: 'kimi-k3', hint: 'cheap' },
      ]);
      expect(loaded?.frontmatter.model).toBe('kimi-k3');
      expect(loaded?.frontmatter.codingAgent).toBe('opencode');
    });

    it('should drop unusable compound entries (empty prefix, empty rest, multi-colon) on write', async () => {
      await writeSpecialistFile({
        id: 'options-malformed-write',
        name: 'Options Malformed Write',
        description: 'Malformed compound entries never persist',
        modelOptions: [
          { model: 'opencode:', hint: 'no rest' },
          { model: ':kimi-k3', hint: 'no prefix' },
          { model: 'a:b:c', hint: 'multi-colon' },
          { model: 'sonnet-4.5', hint: 'kept' },
        ],
        behaviorPrompt: 'Prompt',
      });

      const loaded = await loadSpecialistFile('options-malformed-write');
      expect(loaded?.rawContent).toContain(
        `modelOptions: ${JSON.stringify([{ model: 'sonnet-4.5', hint: 'kept' }])}`,
      );
      expect(loaded?.frontmatter.modelOptions).toEqual([{ model: 'sonnet-4.5', hint: 'kept' }]);
    });

    it('should omit the modelOptions key when undefined and write [] verbatim', async () => {
      await writeSpecialistFile({
        id: 'no-options',
        name: 'No Options',
        description: 'No model options',
        behaviorPrompt: 'Prompt',
      });
      const noOptions = await loadSpecialistFile('no-options');
      expect(noOptions?.rawContent).not.toContain('modelOptions:');
      expect(noOptions?.frontmatter.modelOptions).toBeUndefined();

      await writeSpecialistFile({
        id: 'cleared-options',
        name: 'Cleared Options',
        description: 'Explicit clear',
        modelOptions: [],
        behaviorPrompt: 'Prompt',
      });
      const cleared = await loadSpecialistFile('cleared-options');
      expect(cleared?.rawContent).toContain('modelOptions: []');
      expect(cleared?.frontmatter.modelOptions).toEqual([]);
    });

    it('should round-trip reasoningEffort and omit the key when unset', async () => {
      await writeSpecialistFile({
        id: 'effort-round-trip',
        name: 'Effort Round Trip',
        description: 'Reasoning effort round-trip test specialist',
        codingAgent: 'codex',
        model: 'gpt-5.3-codex',
        reasoningEffort: 'high',
        modelOptions: [
          { provider: 'codex', model: 'gpt-5.3-codex', hint: 'deep', reasoningEffort: 'xhigh' },
        ],
        behaviorPrompt: 'Effort prompt',
      });

      const loaded = await loadSpecialistFile('effort-round-trip');
      expect(loaded?.rawContent).toContain('reasoningEffort: "high"');
      expect(loaded?.frontmatter.reasoningEffort).toBe('high');
      expect(loaded?.frontmatter.modelOptions).toEqual([
        { provider: 'codex', model: 'gpt-5.3-codex', hint: 'deep', reasoningEffort: 'xhigh' },
      ]);

      await writeSpecialistFile({
        id: 'no-effort',
        name: 'No Effort',
        description: 'No reasoning effort',
        behaviorPrompt: 'Prompt',
      });
      const noEffort = await loadSpecialistFile('no-effort');
      expect(noEffort?.rawContent).not.toContain('reasoningEffort:');
      expect(noEffort?.frontmatter.reasoningEffort).toBeUndefined();
    });

    it('should round-trip role/teamAgents/icon and omit the keys when unset', async () => {
      await writeSpecialistFile({
        id: 'role-round-trip',
        name: 'Role Round Trip',
        description: 'Role round-trip test specialist',
        role: 'orchestrator',
        teamAgents: ['implementor', 'verifier'],
        icon: 'coordinator',
        behaviorPrompt: 'Role prompt',
      });

      const loaded = await loadSpecialistFile('role-round-trip');
      expect(loaded?.rawContent).toContain('role: "orchestrator"');
      expect(loaded?.rawContent).toContain('teamAgents: ["implementor","verifier"]');
      expect(loaded?.rawContent).toContain('icon: "coordinator"');
      expect(loaded?.frontmatter.role).toBe('orchestrator');
      expect(loaded?.frontmatter.teamAgents).toEqual(['implementor', 'verifier']);
      expect(loaded?.frontmatter.icon).toBe('coordinator');

      await writeSpecialistFile({
        id: 'no-role',
        name: 'No Role',
        description: 'No role metadata',
        behaviorPrompt: 'Prompt',
      });
      const noRole = await loadSpecialistFile('no-role');
      expect(noRole?.rawContent).not.toContain('role:');
      expect(noRole?.rawContent).not.toContain('teamAgents:');
      expect(noRole?.rawContent).not.toContain('icon:');
      expect(noRole?.frontmatter.role).toBeUndefined();
      expect(noRole?.frontmatter.teamAgents).toBeUndefined();
      expect(noRole?.frontmatter.icon).toBeUndefined();
    });

    it('should write and load project-level specialists from the workspace path', async () => {
      const workspacePath = path.join(TEST_HOME, 'repo-a');

      await writeSpecialistFile({
        id: 'repo-specialist',
        name: 'Repo Specialist',
        description: 'Project-scoped specialist',
        behaviorPrompt: 'Project prompt',
        scope: 'project',
        workspacePath,
      });

      const loaded = await loadSpecialistFile('repo-specialist', 'project', workspacePath);
      const projectList = await loadProjectSpecialistFiles(workspacePath);

      expect(loaded?.source).toBe('project');
      expect(loaded?.behaviorPrompt).toBe('Project prompt');
      expect(projectList.specialists.map((specialist) => specialist.id)).toContain('repo-specialist');
      expect(projectList.specialists[0]?.filePath).toContain(getProjectSpecialistsDirectory(workspacePath));
    });
  });

  describe('Specialist ID generation', () => {
    it('should normalize unicode names and provide a fallback slug', () => {
      expect(sanitizeSpecialistId('Spécialïst Déjà Vu')).toBe('specialist-deja-vu');
      expect(sanitizeSpecialistId('!!!', { fallback: 'specialist' })).toBe('specialist');
    });

    it('should generate unique IDs when collisions already exist', () => {
      expect(generateUniqueSpecialistId('Tech Spec Writer', ['tech-spec-writer'])).toBe(
        'tech-spec-writer-2',
      );
      expect(
        generateUniqueSpecialistId('Tech Spec Writer', [
          'tech-spec-writer',
          'tech-spec-writer-2',
        ]),
      ).toBe('tech-spec-writer-3');
    });
  });
});

describe('Stale specialist fallback on transient refresh failure', () => {
  afterEach(() => {
    vi.doUnmock('../specialist-file-loader');
    vi.resetModules();
    vi.useRealTimers();
  });

  it('serves the last-known-good list when a refresh fails after a successful load', async () => {
    vi.resetModules();

    let shouldThrow = false;
    const staleSpecialist = {
      id: 'test-stale-specialist',
      filePath: '/tmp/test-stale-specialist.md',
      frontmatter: {
        name: 'Test Stale Specialist',
        description: 'For stale fallback test',
      },
      behaviorPrompt: 'You are a stale fallback test specialist.',
      rawContent: '',
      source: 'user' as const,
    };

    vi.doMock('../specialist-file-loader', () => ({
      loadBundledSpecialistFiles: vi.fn(async () => {
        if (shouldThrow) throw new Error('transient bundled load failure');
        return { specialists: [], errors: [] };
      }),
      loadSpecialistFiles: vi.fn(async () => {
        if (shouldThrow) throw new Error('transient user load failure');
        return { specialists: [staleSpecialist], errors: [] };
      }),
      loadProjectSpecialistFiles: vi.fn(async () => ({ specialists: [], errors: [] })),
      migrateCustomSpecialistsFromStore: vi.fn(async () => ({
        migrated: 0,
        skipped: 0,
        errors: [],
      })),
      migrateOverridesFromStore: vi.fn(async () => ({ migrated: 0, errors: [] })),
    }));

    const service = await vi.importActual<
      typeof import('../../../agent/main/specialists.service')
    >('../../../agent/main/specialists.service');

    vi.useFakeTimers();

    // First load succeeds, populating both the TTL cache and last-known-good.
    const firstPrompt = await service.formatSpecialistsForPrompt();
    expect(firstPrompt).toContain('test-stale-specialist');

    // Expire the 5s TTL cache (FILE_CACHE_TTL_MS) so the next access triggers a refresh.
    shouldThrow = true;
    await vi.advanceTimersByTimeAsync(6000);

    // The refresh now throws (swallowed). The fallback must still serve the prior
    // list rather than an empty one.
    const secondPrompt = await service.formatSpecialistsForPrompt();
    expect(secondPrompt).toContain('test-stale-specialist');
  });
});
