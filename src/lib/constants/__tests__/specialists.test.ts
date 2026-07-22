import { describe, expect, it } from 'vitest';

import { getSpecialistById } from '../specialists';

describe('SPECIALISTS', () => {
  it('keeps chief workspace creation extraction guidance', () => {
    const chief = getSpecialistById('chief-of-staff');

    expect(chief?.defaultBehaviorPrompt).toContain('When the user names a branch');
    expect(chief?.defaultBehaviorPrompt).toContain('prUrl');
    expect(chief?.defaultBehaviorPrompt).toContain('example-org/example-repo/pull/648');
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
    expect(chief?.defaultBehaviorPrompt).toMatch(/### NavLink Format/);
    expect(chief?.defaultBehaviorPrompt).toMatch(/ws\.app\.ui\.targets\(\)/);
    expect(chief?.defaultBehaviorPrompt).toMatch(/\/settings\?tab=setup#utility-default-model/);
    expect(chief?.defaultBehaviorPrompt).toMatch(/bare path/i);
    expect(chief?.roleReminder).toMatch(/canonical route/i);
    expect(chief?.roleReminder).toMatch(/hash fragment/i);
  });

  it('teaches Chief to audit agent threads safely and link created notes', () => {
    const chief = getSpecialistById('chief-of-staff');
    expect(chief?.defaultBehaviorPrompt).toMatch(/## Agent Thread Audits/);
    expect(chief?.defaultBehaviorPrompt).toContain(
      'ws.app.agents.list({ workspaceId?, includeCompleted?, limit?, cursor? })',
    );
    expect(chief?.defaultBehaviorPrompt).toContain(
      'ws.app.agents.readConversation(workspaceId, agentId, { lastN?, startTurn?, endTurn?, includeToolCalls? })',
    );
    expect(chief?.defaultBehaviorPrompt).toMatch(/metadata only; no transcript content/i);
    expect(chief?.defaultBehaviorPrompt).toMatch(
      /defaults to the last 20 messages and caps reads at 100/i,
    );
    expect(chief?.defaultBehaviorPrompt).toMatch(/includeToolCalls: true/);
    expect(chief?.defaultBehaviorPrompt).toMatch(/returned `markdownLink`/);
    expect(chief?.defaultBehaviorPrompt).toContain('intent://local/{workspaceId}/note/{noteId}');
  });

  it('teaches Chief to wait on cross-workspace agents instead of polling', () => {
    const chief = getSpecialistById('chief-of-staff');
    expect(chief?.defaultBehaviorPrompt).toMatch(/## Waiting on Agents Across Workspaces/);
    expect(chief?.defaultBehaviorPrompt).toContain(
      'ws.app.agents.waitFor({ agentIds, waitMode? })',
    );
    expect(chief?.defaultBehaviorPrompt).toContain(
      'ws.app.agents.waitFor({ agentIds: ["agent-1111-…", "agent-2222-…"], waitMode: "after_all" })',
    );
    expect(chief?.defaultBehaviorPrompt).toMatch(
      /do not poll[*\s]+`ws\.app\.agents\.list` in a loop/i,
    );
    expect(chief?.defaultBehaviorPrompt).toMatch(/one wake per agent as each finishes/i);
    expect(chief?.defaultBehaviorPrompt).toMatch(
      /single aggregated wake once all listed agents settle/i,
    );
  });
});
