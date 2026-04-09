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
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import {
  parseSpecialistFile,
  writeSpecialistFile,
  loadSpecialistFile,
  loadProjectSpecialistFiles,
  migrateCustomSpecialistsFromStore,
  migrateOverridesFromStore,
  getBundledSpecialistsDirectory,
  getProjectSpecialistsDirectory,
  getSpecialistsDirectory,
} from '../specialist-file-loader';
import { generateUniqueSpecialistId, sanitizeSpecialistId } from '../../../../shared/specialist-file-types';

const { mockSettingsData } = vi.hoisted(() => ({
  mockSettingsData: {} as Record<string, unknown>,
}));

const TEST_HOME = '/tmp/augment-specialist-file-loader-test';
let originalHome: string | undefined;

// Mock electron app
vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp/test-augment',
    isPackaged: false,
  },
}));

vi.mock('electron-store', () => ({
  default: class MockStore {
    get(key: string) {
      return mockSettingsData[key];
    }

    set(key: string, value: unknown) {
      mockSettingsData[key] = value;
    }

    delete(key: string) {
      delete mockSettingsData[key];
    }
  },
}));

beforeAll(async () => {
  originalHome = process.env.HOME;
  process.env.HOME = TEST_HOME;
  await fs.rm(TEST_HOME, { recursive: true, force: true });
});

beforeEach(async () => {
  Object.keys(mockSettingsData).forEach((key) => delete mockSettingsData[key]);
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
modelTier: "fast"
---

You are a test specialist.`;

      const result = parseSpecialistFile('/path/to/test-specialist.md', content);
      expect('error' in result).toBe(false);
      if (!('error' in result)) {
        expect(result.id).toBe('test-specialist');
        expect(result.frontmatter.name).toBe('Test Specialist');
        expect(result.frontmatter.description).toBe('A test specialist');
        expect(result.frontmatter.codingAgent).toBe('codex');
        expect(result.frontmatter.modelTier).toBe('fast');
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

  describe('Invalid modelTier', () => {
    it('should error on invalid modelTier', () => {
      const content = `---
name: "Test"
description: "A test"
modelTier: "invalid"
---

Body`;

      const result = parseSpecialistFile('/path/to/invalid-tier.md', content);
      expect('error' in result).toBe(true);
      if ('error' in result) {
        expect(result.error).toContain('Invalid modelTier');
      }
    });

    it('should accept valid modelTier values', () => {
      for (const tier of ['fast', 'balanced', 'smart']) {
        const content = `---
name: "Test"
description: "A test"
modelTier: "${tier}"
---

Body`;

        const result = parseSpecialistFile(`/path/to/${tier}.md`, content);
        expect('error' in result).toBe(false);
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

  describe('Persistence and migration', () => {
    it('should round-trip codingAgent when writing and loading a specialist file', async () => {
      await writeSpecialistFile({
        id: 'round-trip',
        name: 'Round Trip',
        description: 'Round-trip test specialist',
        codingAgent: 'codex',
        modelTier: 'fast',
        roleReminder: 'Stay focused.',
        behaviorPrompt: 'Round-trip prompt',
      });

      const loaded = await loadSpecialistFile('round-trip');

      expect(loaded).not.toBeNull();
      expect(loaded?.frontmatter.codingAgent).toBe('codex');
      expect(loaded?.frontmatter.modelTier).toBe('fast');
      expect(loaded?.frontmatter.roleReminder).toBe('Stay focused.');
      expect(loaded?.behaviorPrompt).toBe('Round-trip prompt');
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

    it('should migrate custom specialists with and without codingAgent', async () => {
      mockSettingsData['custom-specialists'] = [
        {
          id: 'legacy with agent',
          name: 'Legacy With Agent',
          description: 'Legacy specialist with coding agent',
          codingAgent: 'codex',
          model: 'gpt-5.3-codex/high',
          behaviorPrompt: 'Prompt A',
        },
        {
          id: 'legacy without agent',
          name: 'Legacy Without Agent',
          description: 'Legacy specialist without coding agent',
          model: 'sonnet4.5',
          behaviorPrompt: 'Prompt B',
        },
      ];

      const result = await migrateCustomSpecialistsFromStore();
      const specialistsDir = getSpecialistsDirectory();
      const withAgentContent = await fs.readFile(
        path.join(specialistsDir, 'legacy-with-agent.md'),
        'utf-8',
      );
      const withoutAgentContent = await fs.readFile(
        path.join(specialistsDir, 'legacy-without-agent.md'),
        'utf-8',
      );

      expect(result.migrated).toBe(2);
      expect(result.errors).toEqual([]);
      expect(withAgentContent).toContain('codingAgent: "codex"');
      expect(withoutAgentContent).not.toContain('codingAgent:');
    });

    it('should preserve bundled codingAgent when migrating overrides to a user file', async () => {
      const specialistId = 'override-migration-coding-agent-test';
      const bundledDir = getBundledSpecialistsDirectory();
      const bundledPath = path.join(bundledDir, `${specialistId}.md`);

      await fs.mkdir(bundledDir, { recursive: true });
      await fs.writeFile(
        bundledPath,
        `---
name: "Override Migration Test"
description: "Bundled specialist for override migration"
codingAgent: "codex"
modelTier: "fast"
---

Bundled prompt`,
        'utf-8',
      );

      mockSettingsData['specialists-overrides'] = {
        behaviorPromptOverrides: {
          [specialistId]: 'Overridden prompt',
        },
      };

      try {
        const result = await migrateOverridesFromStore();
        const migrated = await loadSpecialistFile(specialistId);

        expect(result.migrated).toBe(1);
        expect(result.errors).toEqual([]);
        expect(migrated).not.toBeNull();
        expect(migrated?.frontmatter.codingAgent).toBe('codex');
        expect(migrated?.frontmatter.modelTier).toBe('fast');
        expect(migrated?.behaviorPrompt).toBe('Overridden prompt');
      } finally {
        await fs.rm(bundledPath, { force: true });
      }
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
