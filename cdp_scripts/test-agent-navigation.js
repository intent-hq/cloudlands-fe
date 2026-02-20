/**
 * CDP Test Script: Agent Navigation
 *
 * Tests the URL-based navigation system for opening agent drawers.
 *
 * This script:
 * 1. Navigates to a workspace
 * 2. Clicks an agent button in the WorkspaceDock
 * 3. Verifies the URL is updated with the correct parameters
 * 4. Verifies the drawer opens and displays the agent chat
 *
 * Usage:
 *   Run this script via CDP tools to test agent navigation
 */

// Navigate to the Test Comment Overlap System workspace
const workspaceId = '972f43cb-febb-4323-a97b-93c9346bb63e';
const targetUrl = `http://localhost:5177/workspace/${workspaceId}`;

console.log('[Test] Navigating to workspace:', targetUrl);
window.location.href = targetUrl;

// Wait for page to load
await new Promise((resolve) => setTimeout(resolve, 3000));

// Find all agent buttons
const agentButtons = document.querySelectorAll('[data-agent-id]');
console.log('[Test] Found agent buttons:', agentButtons.length);

if (agentButtons.length === 0) {
  throw new Error('No agent buttons found');
}

// Get the first agent ID
const firstAgentId = agentButtons[0].getAttribute('data-agent-id');
console.log('[Test] First agent ID:', firstAgentId);

// Click the first agent button
console.log('[Test] Clicking agent button...');
agentButtons[0].click();

// Wait for navigation and drawer to open
await new Promise((resolve) => setTimeout(resolve, 1000));

// Verify URL was updated
const url = new URL(window.location.href);
const urlParams = {
  drawerOpen: url.searchParams.get('drawerOpen'),
  drawerType: url.searchParams.get('drawerType'),
  selectedAgent: url.searchParams.get('selectedAgent'),
};

console.log('[Test] URL parameters:', urlParams);

// Verify URL parameters are correct
const urlCorrect =
  urlParams.drawerOpen === '1' &&
  urlParams.drawerType === 'agent' &&
  urlParams.selectedAgent === firstAgentId;

if (!urlCorrect) {
  throw new Error('URL parameters are incorrect: ' + JSON.stringify(urlParams));
}

console.log('[Test] ✓ URL parameters are correct');

// Verify drawer container is present
const drawerContainer = document.querySelector('[data-testid="content-drawer-container"]');
if (!drawerContainer) {
  throw new Error('Drawer container not found');
}

console.log('[Test] ✓ Drawer container found');

// Verify drawer container attributes
const containerAttrs = {
  drawerType: drawerContainer.getAttribute('data-drawer-type'),
  contentId: drawerContainer.getAttribute('data-drawer-content-id'),
  ariaLabel: drawerContainer.getAttribute('aria-label'),
};

console.log('[Test] Drawer container attributes:', containerAttrs);

if (containerAttrs.drawerType !== 'agent') {
  throw new Error('Drawer type is not "agent": ' + containerAttrs.drawerType);
}

if (containerAttrs.contentId !== firstAgentId) {
  throw new Error('Drawer content ID does not match agent ID: ' + containerAttrs.contentId);
}

console.log('[Test] ✓ Drawer container attributes are correct');

// Verify ContentDrawer component is present
const drawer = document.querySelector('[data-testid="content-drawer"]');
if (!drawer) {
  throw new Error('ContentDrawer component not found');
}

console.log('[Test] ✓ ContentDrawer component found');

// Verify drawer attributes
const drawerAttrs = {
  contentType: drawer.getAttribute('data-content-type'),
  contentId: drawer.getAttribute('data-content-id'),
  ariaLabel: drawer.getAttribute('aria-label'),
};

console.log('[Test] Drawer attributes:', drawerAttrs);

if (drawerAttrs.contentType !== 'agent') {
  throw new Error('Drawer content type is not "agent": ' + drawerAttrs.contentType);
}

if (drawerAttrs.contentId !== firstAgentId) {
  throw new Error('Drawer content ID does not match agent ID: ' + drawerAttrs.contentId);
}

console.log('[Test] ✓ Drawer attributes are correct');

// Test closing the drawer by clicking another agent
if (agentButtons.length > 1) {
  const secondAgentId = agentButtons[1].getAttribute('data-agent-id');
  console.log('[Test] Clicking second agent button:', secondAgentId);

  agentButtons[1].click();
  await new Promise((resolve) => setTimeout(resolve, 1000));

  // Verify URL was updated to second agent
  const newUrl = new URL(window.location.href);
  const newSelectedAgent = newUrl.searchParams.get('selectedAgent');

  if (newSelectedAgent !== secondAgentId) {
    throw new Error('URL not updated to second agent: ' + newSelectedAgent);
  }

  console.log('[Test] ✓ Navigation to second agent works');

  // Verify drawer content changed
  const updatedDrawer = document.querySelector('[data-testid="content-drawer"]');
  const updatedContentId = updatedDrawer?.getAttribute('data-content-id');

  if (updatedContentId !== secondAgentId) {
    throw new Error('Drawer content not updated to second agent: ' + updatedContentId);
  }

  console.log('[Test] ✓ Drawer content updated to second agent');
}

console.log('[Test] ✅ All tests passed!');

return {
  success: true,
  message: 'Agent navigation test completed successfully',
  testedAgents: Array.from(agentButtons).map((btn) => btn.getAttribute('data-agent-id')),
};
