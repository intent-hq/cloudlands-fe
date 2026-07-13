import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

const { getSafeHomeDirMock } = vi.hoisted(() => ({
  getSafeHomeDirMock: vi.fn<() => string>(),
}));

vi.mock('../../../../shared/main/utils', () => ({
  getSafeHomeDir: getSafeHomeDirMock,
}));

vi.mock('../../../../shared/logger', () => ({
  Logger: class MockLogger {
    info = vi.fn();
    debug = vi.fn();
    warn = vi.fn();
    error = vi.fn();
  },
}));

import {
  discoverSkills,
  formatSkillsCatalogForPrompt,
} from '../skills-loader';

function buildSkillContent(frontmatter: string, body = 'Use this skill when needed.') {
  return `---\n${frontmatter}\n---\n\n${body}\n`;
}

async function writeSkill(skillRoot: string, skillName: string, content: string) {
  const skillDir = path.join(skillRoot, skillName);
  const skillPath = path.join(skillDir, 'SKILL.md');
  await fs.mkdir(skillDir, { recursive: true });
  await fs.writeFile(skillPath, content, 'utf8');
  return skillPath;
}

describe('skills-loader', () => {
  let tempDir: string;
  let workspacePath: string;
  let homeDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'skills-loader-test-'));
    workspacePath = path.join(tempDir, 'workspace');
    homeDir = path.join(tempDir, 'home');
    await fs.mkdir(workspacePath, { recursive: true });
    await fs.mkdir(homeDir, { recursive: true });
    getSafeHomeDirMock.mockReturnValue(homeDir);
  });

  afterEach(async () => {
    vi.clearAllMocks();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('discovers and parses a valid SKILL.md file', async () => {
    const skillPath = await writeSkill(
      path.join(workspacePath, '.agents', 'skills'),
      'valid-skill',
      buildSkillContent('name: valid-skill\ndescription: Valid skill description'),
    );

    await expect(discoverSkills(workspacePath)).resolves.toEqual([
      expect.objectContaining({
        name: 'valid-skill',
        description: 'Valid skill description',
        location: skillPath,
      }),
    ]);
  });

  it('skips skills missing a description', async () => {
    await writeSkill(
      path.join(workspacePath, '.agents', 'skills'),
      'missing-description',
      buildSkillContent('name: missing-description'),
    );

    await expect(discoverSkills(workspacePath)).resolves.toEqual([]);
  });

  it('parses malformed YAML values with unquoted colons via fallback logic', async () => {
    await writeSkill(
      path.join(workspacePath, '.agents', 'skills'),
      'fallback-skill',
      buildSkillContent('name: fallback-skill\ndescription: Use when: the user asks'),
    );

    const [skill] = await discoverSkills(workspacePath);

    expect(skill).toEqual(
      expect.objectContaining({
        name: 'fallback-skill',
        description: 'Use when: the user asks',
      }),
    );
  });

  it('returns an empty string when no skills exist', async () => {
    await expect(formatSkillsCatalogForPrompt(workspacePath)).resolves.toBe('');
  });

  it('formats discovered skills as the expected XML catalog', async () => {
    const skillPath = await writeSkill(
      path.join(workspacePath, '.augment', 'skills'),
      'catalog-skill',
      buildSkillContent('name: catalog-skill\ndescription: Formats catalog output'),
    );

    const catalog = await formatSkillsCatalogForPrompt(workspacePath);

    expect(catalog).toContain('<available_skills>');
    expect(catalog).toContain('<skill>');
    expect(catalog).toContain('<name>catalog-skill</name>');
    expect(catalog).toContain('<description>Formats catalog output</description>');
    expect(catalog).toContain(`<location>${skillPath}</location>`);
    expect(catalog).toContain('</available_skills>');
  });

  it('handles non-existent scan directories without throwing', async () => {
    const missingWorkspacePath = path.join(tempDir, 'missing-workspace');

    await expect(discoverSkills(missingWorkspacePath)).resolves.toEqual([]);
    await expect(formatSkillsCatalogForPrompt(missingWorkspacePath)).resolves.toBe('');
  });

  it('prefers the project-level skill when names collide', async () => {
    await writeSkill(
      path.join(homeDir, '.augment', 'skills'),
      'shared-skill',
      buildSkillContent('name: shared-skill\ndescription: User-level description'),
    );
    const projectSkillPath = await writeSkill(
      path.join(workspacePath, '.agents', 'skills'),
      'shared-skill',
      buildSkillContent('name: shared-skill\ndescription: Project-level description'),
    );

    await expect(discoverSkills(workspacePath)).resolves.toEqual([
      expect.objectContaining({
        name: 'shared-skill',
        description: 'Project-level description',
        location: projectSkillPath,
      }),
    ]);
  });
});