export interface ReplaceAgentHandoffParams {
  /** Exact current name of the agent being replaced. */
  agentName: string;
  /** Specialist id from the session metadata, when known. */
  specialist?: string | null;
}

/**
 * Builds the default "Replace Agent" hand-off instruction sent to the old
 * agent as a normal chat message. The prompt is deliberately English-only
 * (agent-facing, not localized); the modal UI copy around it is localized.
 *
 * The instruction directs the agent through the full peer hand-off protocol:
 * spawn a same-name (and same-specialist when known) top-level replacement
 * via `ws.agent.create(..., { topLevel: true })`, run a gradual Q&A hand-off
 * dialog, keep monitoring its own child agents (children are not
 * transferred), have the replacement re-arm hooks/PR monitors/subscriptions/
 * watches, and only retire via `ws.agent.retire` once both agents mutually
 * agree the hand-off is complete.
 */
export function buildReplaceAgentHandoffMessage({
  agentName,
  specialist,
}: ReplaceAgentHandoffParams): string {
  const createOptions = specialist
    ? `{ topLevel: true, specialist: ${JSON.stringify(specialist)} }`
    : `{ topLevel: true }`;
  const specialistClause = specialist
    ? `and keep the same specialist (${JSON.stringify(specialist)})`
    : `and, if you were created with a specialist, pass that exact same \`specialist\` value in the options`;

  return `Please replace yourself with a fresh top-level agent and run a gradual, coordinated hand-off:

1. Create your replacement now: call \`ws.agent.create(${JSON.stringify(agentName)}, kickoffMessage, ${createOptions})\`. The first argument must be your EXACT current name (${JSON.stringify(agentName)}) ${specialistClause}. Write the kickoff message as a thorough context hand-off: the overall goal, the current state of the work, key notes and files, decisions already made, and open threads.

2. Run a hand-off dialog: invite the replacement to ask questions about that initial context and answer them via \`ws.agent.send\`, transferring new work and remaining context gradually instead of all at once.

3. Keep monitoring your own in-flight child agents until their work completes — child agents are NOT transferred to the replacement.

4. Have the replacement re-arm equivalents of your background state — hooks (\`ws.hook.*\`), PR monitors (\`ws.pr.monitor\`), event subscriptions, and agent watches — telling it exactly what each one watches and why. Once the replacement confirms its versions are active, cancel your own (anything left over is auto-cancelled when you retire).

5. Only after you and the replacement MUTUALLY agree the hand-off is complete — and your children and hooks are settled — call \`ws.agent.retire(reason)\` with a short reason to retire yourself.`;
}
