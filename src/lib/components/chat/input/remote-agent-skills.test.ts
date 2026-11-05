import { describe, expect, it } from 'vitest';

import { remoteSlashCopy } from './remote-agent-skills';

const skill = { name: 'review', description: 'd', location: '/m/review/SKILL.md' };

describe('remoteSlashCopy', () => {
  it('says nothing for a backend agent', () => {
    expect(remoteSlashCopy(undefined)).toEqual({});
  });

  it('names the machine when it has no skills', () => {
    expect(
      remoteSlashCopy({
        machine: 'Mac Studio',
        skills: [],
        stale: false,
        unavailable: null,
        ready: true,
      }),
    ).toMatchObject({ emptyLabel: 'No skills on Mac Studio', notice: undefined });
  });

  it('asks for an update when the machine is too old, keeping project skills', () => {
    expect(
      remoteSlashCopy({
        machine: 'Mac Studio',
        skills: [skill],
        stale: false,
        unavailable: 'machine-update-required',
        ready: true,
      }),
    ).toEqual({
      emptyLabel: 'Update Intent on Mac Studio to see its skills',
      notice: 'Update Intent on Mac Studio to see its skills',
    });
  });

  it('says the machine cannot be reached, or that the list is its last one', () => {
    expect(
      remoteSlashCopy({
        machine: 'Mac Studio',
        skills: [],
        stale: false,
        unavailable: 'machine-offline',
        ready: true,
      }),
    ).toEqual({
      emptyLabel: "Can't reach Mac Studio to list its skills",
      notice: "Can't reach Mac Studio to list its skills",
    });
    expect(
      remoteSlashCopy({
        machine: 'Mac Studio',
        skills: [skill],
        stale: true,
        unavailable: null,
        ready: true,
      }),
    ).toMatchObject({
      emptyLabel: 'No skills on Mac Studio',
      notice: 'Mac Studio is offline. These are its last known skills.',
    });
  });

  it("marks chips only while the machine's catalog is known", () => {
    expect(
      remoteSlashCopy({
        machine: 'Mac Studio',
        skills: [skill],
        stale: false,
        unavailable: 'machine-update-required',
        ready: true,
      }).unavailableTitle,
    ).toBeUndefined();
  });

  it('marks a chip for a skill the machine does not have', () => {
    const copy = remoteSlashCopy({
      machine: 'Mac Studio',
      skills: [skill],
      stale: false,
      unavailable: null,
      ready: true,
    });
    expect(copy.unavailableTitle?.('deploy')).toBe(
      "/deploy isn't on Mac Studio. Add it to ~/.agents/skills or ~/.claude/skills there, or run this agent on the backend.",
    );
    expect(copy.unavailableTitle?.('review')).toBeUndefined();
  });

  it('marks no chip while the list loads or after it failed', () => {
    const loading = remoteSlashCopy({
      machine: 'Mac Studio',
      skills: [],
      stale: false,
      unavailable: null,
      ready: false,
    });
    expect(loading.unavailableTitle).toBeUndefined();
    expect(loading.emptyLabel).toBe('No skills on Mac Studio');
  });
});
