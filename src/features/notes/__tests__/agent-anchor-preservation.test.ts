import { describe, it, expect } from 'vitest';
import { extractAgentAnchors, preserveAgentAnchors } from '../agent-anchor-preservation';

describe('agent-anchor-preservation', () => {
  describe('extractAgentAnchors', () => {
    it('should extract agent anchors from markdown', () => {
      const markdown = `# Tasks
- [ ] First task <!--agent:agent-123-->
- [ ] Second task
- [x] Third task <!--agent:agent-456-->
`;
      const anchors = extractAgentAnchors(markdown);
      expect(anchors).toHaveLength(2);
      expect(anchors[0].agentId).toBe('agent-123');
      expect(anchors[0].taskText).toBe('First task');
      expect(anchors[1].agentId).toBe('agent-456');
      expect(anchors[1].taskText).toBe('Third task');
    });

    it('should return empty array when no anchors', () => {
      const markdown = `# Tasks
- [ ] First task
- [ ] Second task
`;
      const anchors = extractAgentAnchors(markdown);
      expect(anchors).toHaveLength(0);
    });

    it('should handle empty string', () => {
      expect(extractAgentAnchors('')).toHaveLength(0);
    });

    it('should handle null/undefined', () => {
      // @ts-expect-error - testing null input
      expect(extractAgentAnchors(null)).toHaveLength(0);
      // @ts-expect-error - testing undefined input
      expect(extractAgentAnchors(undefined)).toHaveLength(0);
    });

    it('should handle anchor with special characters in agent ID', () => {
      const markdown = '- [ ] Task <!--agent:agent-abc-123-def-->';
      const anchors = extractAgentAnchors(markdown);
      expect(anchors).toHaveLength(1);
      expect(anchors[0].agentId).toBe('agent-abc-123-def');
    });
  });

  describe('preserveAgentAnchors', () => {
    it('should preserve anchors when agent updates note without them', () => {
      const existingContent = `# Tasks
- [ ] First task <!--agent:agent-123-->
- [ ] Second task
`;
      const newContent = `# Tasks
- [ ] First task
- [ ] Second task
- [ ] Third task
`;
      const result = preserveAgentAnchors(existingContent, newContent);
      expect(result.preserved).toContain('agent-123');
      expect(result.content).toContain('<!--agent:agent-123-->');
      expect(result.lost).toHaveLength(0);
    });

    it('should not duplicate anchors if already present', () => {
      const existingContent = `# Tasks
- [ ] First task <!--agent:agent-123-->
`;
      const newContent = `# Tasks
- [ ] First task <!--agent:agent-123-->
`;
      const result = preserveAgentAnchors(existingContent, newContent);
      expect(result.preserved).toHaveLength(0);
      const anchorCount = (result.content.match(/<!--agent:agent-123-->/g) || []).length;
      expect(anchorCount).toBe(1);
    });

    it('should match by similarity when task text changes slightly', () => {
      const existingContent = `# Tasks
- [ ] Implement the login feature <!--agent:agent-789-->
`;
      const newContent = `# Tasks
- [ ] Implement the login feature (in progress)
`;
      const result = preserveAgentAnchors(existingContent, newContent);
      expect(result.preserved).toContain('agent-789');
      expect(result.content).toContain('<!--agent:agent-789-->');
    });

    it('should report lost anchor when task is removed', () => {
      const existingContent = `# Tasks
- [ ] First task <!--agent:agent-111-->
- [ ] Second task
`;
      const newContent = `# Tasks
- [ ] Second task
`;
      const result = preserveAgentAnchors(existingContent, newContent);
      expect(result.lost).toContain('agent-111');
      expect(result.preserved).toHaveLength(0);
    });

    it('should handle multiple anchors', () => {
      const existingContent = `# Tasks
- [ ] Implement Task A feature <!--agent:agent-aaa-->
- [ ] Implement Task B feature <!--agent:agent-bbb-->
- [ ] Implement Task C feature <!--agent:agent-ccc-->
`;
      const newContent = `# Tasks
- [ ] Implement Task A feature
- [ ] Implement Task B feature (in progress)
- [ ] New Task D
`;
      const result = preserveAgentAnchors(existingContent, newContent);
      expect(result.preserved).toContain('agent-aaa');
      expect(result.preserved).toContain('agent-bbb');
      expect(result.lost).toContain('agent-ccc');
    });

    it('should handle null/undefined inputs gracefully', () => {
      // @ts-expect-error - testing null input
      expect(preserveAgentAnchors(null, 'content').content).toBe('content');
      // @ts-expect-error - testing undefined input
      expect(preserveAgentAnchors(undefined, 'content').content).toBe('content');
      // @ts-expect-error - testing null new content
      expect(preserveAgentAnchors('content', null).content).toBe('');
    });

    it('should handle empty strings', () => {
      const result = preserveAgentAnchors('', '- [ ] Task');
      expect(result.content).toBe('- [ ] Task');
      expect(result.preserved).toHaveLength(0);
      expect(result.lost).toHaveLength(0);
    });

    it('should handle nested task lists', () => {
      const existingContent = `# Tasks
- [ ] Parent task
  - [ ] Child task <!--agent:agent-nested-->
`;
      const newContent = `# Tasks
- [ ] Parent task
  - [ ] Child task (updated)
`;
      const result = preserveAgentAnchors(existingContent, newContent);
      expect(result.preserved).toContain('agent-nested');
    });

    it('should handle in-progress checkbox state', () => {
      const existingContent = '- [/] In progress task <!--agent:agent-wip-->';
      const newContent = '- [/] In progress task';
      const result = preserveAgentAnchors(existingContent, newContent);
      expect(result.preserved).toContain('agent-wip');
    });

    it('should handle completed checkbox state', () => {
      const existingContent = '- [x] Completed task <!--agent:agent-done-->';
      const newContent = '- [x] Completed task';
      const result = preserveAgentAnchors(existingContent, newContent);
      expect(result.preserved).toContain('agent-done');
    });
  });
});
