import { describe, expect, it } from 'vitest';

import { getSpecialistById } from '../specialists';

describe('SPECIALISTS', () => {
  it('defines the Vulnerability Scanner fallback metadata and prompt', () => {
    const specialist = getSpecialistById('vulnerability-scanner');

    expect(specialist).toMatchObject({
      id: 'vulnerability-scanner',
      name: 'Vulnerability Scanner',
      description: 'Finds real, exploitable security vulnerabilities in code',
      icon: 'pr-reviewer',
    });
    expect(specialist).not.toHaveProperty('codingAgent');
    expect(specialist).not.toHaveProperty('defaultModel');
    expect(specialist?.role).toBeUndefined();
    expect(specialist?.hidden).toBeUndefined();
    expect(specialist?.defaultBehaviorPrompt).toContain('## Vulnerability Scanner');
    expect(specialist?.defaultBehaviorPrompt).toContain(
      '**MUST trace real code paths. NEVER speculate about vulnerabilities',
    );
    expect(specialist?.defaultBehaviorPrompt).toContain('`ws.note.create` through `workspace_api`');
    expect(specialist?.defaultBehaviorPrompt).toContain('`ws.agent.reportToParent`');
    expect(specialist?.defaultBehaviorPrompt).toContain('**Top-level agent**');
    expect(specialist?.defaultBehaviorPrompt).not.toContain('submit_comments');
    expect(specialist?.defaultBehaviorPrompt).not.toContain('create_note_workspace-mcp');
  });

  it('keeps chief workspace creation extraction guidance', () => {
    const chief = getSpecialistById('chief-of-staff');
    expect(chief?.defaultBehaviorPrompt).toContain('When the user names a branch');
    expect(chief?.defaultBehaviorPrompt).toContain('prUrl');
  });

  // Regression: the agent was emitting a multi-ID workspace block followed by a
  // bullet list that labeled each workspace by its slug (e.g. `user-bug-2 — PR
  // #650 open...`). The "Showing Workspaces" section must keep telling the
  // agent to (1) never use the slug as a prose label and (2) interleave a
  // single-ID `workspace` block with its commentary rather than stacking cards
  // then bullets.
  it('forbids using workspace ID slugs as prose labels', () => {
    const chief = getSpecialistById('chief-of-staff');
    expect(chief?.defaultBehaviorPrompt).toMatch(/never refer to a workspace by its id slug/i);
    expect(chief?.roleReminder).toMatch(/never use a workspace id slug/i);
  });

  it('teaches the interleaved single-ID workspace-block pattern', () => {
    const chief = getSpecialistById('chief-of-staff');
    expect(chief?.defaultBehaviorPrompt).toMatch(/interleave cards with their commentary/i);
    expect(chief?.defaultBehaviorPrompt).toMatch(/single-id[*\s]+`workspace` block/i);
    // The anti-patterns list must call out the exact "cards-then-bullets" shape.
    expect(chief?.defaultBehaviorPrompt).toMatch(
      /multi-id `workspace` block followed by a bullet list that names each workspace by its slug/i,
    );
  });

  // Regression: the agent was emitting NavLinks with bare paths like
  // `/settings`, which land at the top of the page with no row highlight. The
  // prompt must teach the exact fenced-block format, require the full
  // canonical route (including hash fragment) from ws.app.ui.targets(), and
  // call out the bare-path anti-pattern with a concrete example.
  it('teaches NavLinks must use the full canonical route with a hash fragment', () => {
    const chief = getSpecialistById('chief-of-staff');
    expect(chief?.defaultBehaviorPrompt).toMatch(/ws\.app\.ui\.targets\(\)/);
    expect(chief?.defaultBehaviorPrompt).toMatch(/query and hash fragment/);
    expect(chief?.defaultBehaviorPrompt).toMatch(/bare path/i);
    expect(chief?.roleReminder).toMatch(/canonical route/i);
    expect(chief?.roleReminder).toMatch(/hash fragment/i);
  });
});
