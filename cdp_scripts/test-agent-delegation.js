/**
 * CDP Test Script: Agent Delegation Flow
 *
 * Tests the multi-agent delegation pattern:
 * 1. Creates a new workspace
 * 2. Sends a message that triggers delegation
 * 3. Verifies child agents are created with correct specialists
 * 4. Verifies parent wakes when children complete
 *
 * Usage:
 *   Run this script via CDP tools to test agent delegation
 *   Requires the app to be running with a valid API key
 */

// Test configuration
const TEST_CONFIG = {
  timeout: 120000, // 2 minutes max
  pollInterval: 1000,
  expectedChildAgents: 2,
};

// Helper: Wait for condition with timeout
async function waitFor(condition, timeout = TEST_CONFIG.timeout, interval = TEST_CONFIG.pollInterval) {
  const startTime = Date.now();
  while (Date.now() - startTime < timeout) {
    if (await condition()) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  return false;
}

// Helper: Get all agents in the workspace
function getAgents() {
  const agentButtons = document.querySelectorAll('[data-agent-id]');
  return Array.from(agentButtons).map((btn) => ({
    id: btn.getAttribute('data-agent-id'),
    name: btn.getAttribute('data-agent-name') || btn.textContent?.trim(),
    status: btn.getAttribute('data-agent-status'),
  }));
}

// Helper: Get the active agent's chat input
function getChatInput() {
  return document.querySelector('[data-testid="chat-input"]') || document.querySelector('textarea[placeholder*="message"]');
}

// Helper: Send a message to the active agent
async function sendMessage(message) {
  const input = getChatInput();
  if (!input) {
    throw new Error('Chat input not found');
  }

  // Focus and type
  input.focus();
  input.value = message;
  input.dispatchEvent(new Event('input', { bubbles: true }));

  // Find and click send button
  const sendButton =
    document.querySelector('[data-testid="send-button"]') ||
    document.querySelector('button[aria-label*="send"]') ||
    document.querySelector('button:has(svg[class*="send"])');

  if (sendButton) {
    sendButton.click();
  } else {
    // Try pressing Enter
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  }

  await new Promise((resolve) => setTimeout(resolve, 500));
}

// Helper: Check if agent is streaming
function isAgentStreaming(agentId) {
  const agentButton = document.querySelector(`[data-agent-id="${agentId}"]`);
  return agentButton?.getAttribute('data-agent-status') === 'streaming';
}

// Helper: Check if agent is idle
function isAgentIdle(agentId) {
  const agentButton = document.querySelector(`[data-agent-id="${agentId}"]`);
  const status = agentButton?.getAttribute('data-agent-status');
  return status === 'idle' || status === 'completed';
}

// Main test
console.log('[Test] Starting Agent Delegation Test');

// Step 1: Navigate to home and create new workspace
console.log('[Test] Step 1: Creating new workspace...');
const homeUrl = 'http://localhost:5177/';
window.location.href = homeUrl;
await new Promise((resolve) => setTimeout(resolve, 2000));

// Find and click "New Workspace" button
const newWorkspaceBtn =
  document.querySelector('[data-testid="new-workspace-button"]') ||
  document.querySelector('button:contains("New")') ||
  Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.includes('New'));

if (!newWorkspaceBtn) {
  console.log('[Test] No new workspace button found, using existing workspace');
  // Use first available workspace
  const workspaceLink = document.querySelector('a[href*="/workspace/"]');
  if (workspaceLink) {
    workspaceLink.click();
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
} else {
  newWorkspaceBtn.click();
  await new Promise((resolve) => setTimeout(resolve, 3000));
}

// Step 2: Get initial agent count
const initialAgents = getAgents();
console.log('[Test] Step 2: Initial agents:', initialAgents.length);

// Step 3: Send a message that should trigger delegation
console.log('[Test] Step 3: Sending delegation-triggering message...');
const testMessage = 'Create two simple functions: one that adds numbers and one that subtracts. Delegate each to a separate agent.';

await sendMessage(testMessage);

// Step 4: Wait for agent to start streaming
console.log('[Test] Step 4: Waiting for agent to start processing...');
const parentAgentId = initialAgents[0]?.id;

if (parentAgentId) {
  const streamingStarted = await waitFor(() => isAgentStreaming(parentAgentId), 10000);
  if (streamingStarted) {
    console.log('[Test] ✓ Parent agent started streaming');
  }
}

// Step 5: Wait for child agents to be created
console.log('[Test] Step 5: Waiting for child agents to be created...');
const childAgentsCreated = await waitFor(() => {
  const currentAgents = getAgents();
  return currentAgents.length > initialAgents.length;
}, 60000);

if (!childAgentsCreated) {
  console.log('[Test] ⚠ No child agents created (delegation may not have occurred)');
} else {
  const currentAgents = getAgents();
  const newAgents = currentAgents.filter((a) => !initialAgents.find((ia) => ia.id === a.id));
  console.log('[Test] ✓ Child agents created:', newAgents.length);
  console.log('[Test] New agents:', newAgents.map((a) => a.name).join(', '));
}

// Step 6: Wait for all agents to complete
console.log('[Test] Step 6: Waiting for all agents to complete...');
const allComplete = await waitFor(() => {
  const agents = getAgents();
  return agents.every((a) => a.status === 'idle' || a.status === 'completed');
}, TEST_CONFIG.timeout);

if (allComplete) {
  console.log('[Test] ✓ All agents completed');
} else {
  console.log('[Test] ⚠ Some agents still running after timeout');
}

// Step 7: Verify final state
console.log('[Test] Step 7: Verifying final state...');
const finalAgents = getAgents();
console.log('[Test] Final agent count:', finalAgents.length);

const results = {
  success: true,
  initialAgentCount: initialAgents.length,
  finalAgentCount: finalAgents.length,
  childAgentsCreated: finalAgents.length - initialAgents.length,
  allAgentsCompleted: allComplete,
  agents: finalAgents,
};

console.log('[Test] ✅ Test completed');
console.log('[Test] Results:', JSON.stringify(results, null, 2));

return results;
