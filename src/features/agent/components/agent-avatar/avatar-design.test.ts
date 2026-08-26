import { describe, expect, it } from 'vitest';
import {
  builtinAgentAvatarDesigns,
  builtinSpecialistAvatarDesigns,
  fallbackAgentAvatarDesigns,
  getAgentAvatarDesign,
  getFallbackAgentAvatarDesign,
  isBuiltinAgentAvatarDesign,
} from './avatar-design';
import { agentAvatarCatalogIdentities } from './agent-avatar.catalog';

describe('agent avatar design selection', () => {
  it('maps every built-in specialist to its approved Figma center design', () => {
    expect(builtinSpecialistAvatarDesigns).toEqual({
      coordinator: 'coordinator',
      'spec-writer': 'coordinator',
      implementor: 'implementor',
      verifier: 'verifier',
      developer: 'verifier',
      'pr-reviewer': 'pr-reviewer',
      'ui-designer': 'ui-designer',
      'chief-of-staff': 'chief-of-staff',
      ralph: 'ralph',
    });
  });

  it.each(Object.entries(builtinSpecialistAvatarDesigns))(
    'keeps %s stable across agent identities',
    (specialist, design) => {
      expect(getAgentAvatarDesign('agent-a', specialist)).toBe(design);
      expect(getAgentAvatarDesign('agent-b', specialist)).toBe(design);
    },
  );

  it('uses only seeded fallback centers for custom and providerless agents', () => {
    for (const specialist of [null, 'custom-specialist', 'codex', 'claude-code']) {
      expect(fallbackAgentAvatarDesigns).toContain(
        getAgentAvatarDesign('stable-agent-id', specialist),
      );
    }
  });

  it('is deterministic across repeated selection and exposes all six fallback centers', () => {
    const agentIds = Array.from({ length: 100 }, (_, index) => `agent-${index}`);
    const first = agentIds.map(getFallbackAgentAvatarDesign);
    const second = agentIds.map(getFallbackAgentAvatarDesign);

    expect(second).toEqual(first);
    expect(new Set(first)).toEqual(new Set(fallbackAgentAvatarDesigns));
  });

  it('gives the catalog one stable identity for every design', () => {
    expect(new Set(agentAvatarCatalogIdentities.map(({ design }) => design)).size).toBe(13);
    for (const identity of agentAvatarCatalogIdentities) {
      expect(getAgentAvatarDesign(identity.agentId, identity.specialist)).toBe(identity.design);
    }
  });

  it.each(builtinAgentAvatarDesigns)(
    'resolves icon %s ahead of the specialist-id map and the seeded fallback',
    (icon) => {
      expect(getAgentAvatarDesign('agent-a', 'implementor', icon)).toBe(icon);
      expect(getAgentAvatarDesign('agent-a', 'custom-specialist', icon)).toBe(icon);
      expect(getAgentAvatarDesign('agent-a', null, icon)).toBe(icon);
    },
  );

  it('degrades unknown or absent icons to the id map, then the seeded fallback', () => {
    for (const icon of [undefined, null, '', 'not-a-design', 'fallback-glasses']) {
      expect(getAgentAvatarDesign('agent-a', 'implementor', icon)).toBe('implementor');
      expect(getAgentAvatarDesign('agent-a', 'custom-specialist', icon)).toBe(
        getFallbackAgentAvatarDesign('agent-a'),
      );
    }
  });

  it('validates icon values against the built-in design set only', () => {
    for (const design of builtinAgentAvatarDesigns) {
      expect(isBuiltinAgentAvatarDesign(design)).toBe(true);
    }
    for (const value of ['', 'not-a-design', 'fallback-glasses', 'spec-writer']) {
      expect(isBuiltinAgentAvatarDesign(value)).toBe(false);
    }
  });
});
