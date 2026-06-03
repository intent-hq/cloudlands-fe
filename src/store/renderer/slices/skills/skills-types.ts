/**
 * Skills slice types.
 *
 * Safe to import from any process (renderer, main, shared, preload).
 */

export type SkillInfo = {
  name: string;
  description: string;
  location: string;
  scope?: "project" | "user";
};

export type SkillsWorkspaceState = {
  skills: SkillInfo[];
  loading: boolean;
  error: string | null;
};

export type SkillsState = {
  byWorkspaceId: Record<string, SkillsWorkspaceState>;
};

