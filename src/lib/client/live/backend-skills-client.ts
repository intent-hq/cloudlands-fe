import type { SkillInfo } from '../../../store/renderer/slices/skills/skills-types';
import type { SkillsReadClient } from '../lifecycle-read-client-types';
import type { BackendRuntime } from './backend-transport-runtime';

/**
 * Wire shape for `skill.list` response per PROTOCOL §5.34 — a bare array of
 * skill objects (no envelope). Includes optional frontmatter fields
 * (`allowedTools`, `compatibility`) that the renderer `SkillInfo` contract
 * omits.
 */
interface WireSkill {
  name: string;
  description: string;
  location: string;
  resourceDirectory?: string;
  scope: 'project' | 'user';
  allowedTools?: string;
  compatibility?: string;
}

/** Map wire skill → renderer SkillInfo (strip allowedTools/compatibility). */
function normalizeSkill(wire: WireSkill): SkillInfo {
  return {
    name: wire.name,
    description: wire.description,
    location: wire.location,
    ...(wire.resourceDirectory ? { resourceDirectory: wire.resourceDirectory } : {}),
    scope: wire.scope,
  };
}

export function createBackendSkillsClient(
  backend: Pick<BackendRuntime, 'backendRequest'>,
): SkillsReadClient {
  const { backendRequest } = backend;
  return {
    /** Raw `skill.list` fetch — throws on transport/daemon failure. */
    async list(workspaceId: string): Promise<SkillInfo[]> {
      // `skill.list` (§5.34) returns a bare array of skills (name-sorted).
      const result = await backendRequest<WireSkill[]>('skill.list', { workspaceId });
      return Array.isArray(result) ? result.map(normalizeSkill) : [];
    },
  };
}
