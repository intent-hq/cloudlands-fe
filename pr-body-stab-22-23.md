Fixes two related footer hydration bugs in the coordinator view.

## STAB-23: Subscription footer missing after delegation cleanup

**Root cause:** 
- resetSubscriptionUI DELETES the slice entry after completed group cleanup
- refreshWorkspaceSubscriptionEntries only fans out over tracked entries
- AgentSubscriptions.svelte's lastFetchKey guard prevents refetching same (workspace, agent)
- Chain: delete entry → new delegation event → refresh skips deleted entry → component never refetches

**Fix:**
- Changed resetSubscriptionUI to keep an idle entry instead of deleting
- Added deleteSubscriptionUI action for actual deletion on workspace purge
- This allows refreshWorkspaceSubscriptionEntries to reach the agent even after cleanup
- No LEAK-1 regression: workspace deleted purge still uses deleteSubscriptionUI to actually remove entries

**Justification:**
This is the least-leaky option compared to:
- Keeping idle entries + deleting on unmount (would leak during workspace lifetime)
- Maintaining a mounted-component registry (complex, state/component coupling)
- Event-triggered refetch (requires parent agent lookup from child events)

## STAB-22: AgentCard preview frozen for unwatched agents

**Root cause:**
- agent:message events ARE emitted by daemon since intentd PR #132
- daemon-events-bridge routes them to eventReceived
- But AgentCard gets lastResponse from agent session's messages array
- For agents whose tab was never opened, conversation was never hydrated

**Fix:**
- Added agent:message event handler in daemon-events-bridge
- When role==assistant, calls loadChatTranscript to fetch full conversation
- This updates the messages array, which updates lastResponse in AgentCard

## Testing

Targeted tests needed:
- [ ] STAB-23 regression test: delete→delegate sequence
- [ ] STAB-22 test: agent:message event → lastResponse updated
- [ ] LEAK-1 test: workspace purge deletes entries

Gates:
- [x] Typecheck green
- [ ] Lint green  
- [ ] Vitest suite green

Related: STAB-22, STAB-23 in docs/01_stabilizing/KNOWN_ISSUES.md
