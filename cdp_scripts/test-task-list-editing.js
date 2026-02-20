/**
 * Test task list editing to verify cursor doesn't jump
 *
 * This script:
 * 1. Finds the TipTap editor
 * 2. Types some task list content
 * 3. Verifies the content is correct
 */

// Wait for the editor to be ready
await cdp.waitForTimeout(1000);

// Find the TipTap editor
const editor = await cdp.locator('.ProseMirror').first();

if (!editor) {
  console.log('❌ Could not find TipTap editor');
  return { success: false, error: 'Editor not found' };
}

console.log('✅ Found TipTap editor');

// Click on the editor to focus it
await editor.click();
await cdp.waitForTimeout(500);

// Clear any existing content
await cdp.keyboard.press('Control+A');
await cdp.keyboard.press('Backspace');
await cdp.waitForTimeout(200);

// Type some task list content
console.log('Typing task list content...');
await cdp.keyboard.type('- [ ] First task');
await cdp.keyboard.press('Enter');
await cdp.keyboard.type('- [x] Second task');
await cdp.keyboard.press('Enter');
await cdp.keyboard.type('- [ ] Third task');
await cdp.waitForTimeout(500);

// Get the editor content
const content = await editor.textContent();
console.log('Editor content:', content);

// Check if the content is correct
const hasFirstTask = content.includes('First task');
const hasSecondTask = content.includes('Second task');
const hasThirdTask = content.includes('Third task');

console.log('Has first task:', hasFirstTask);
console.log('Has second task:', hasSecondTask);
console.log('Has third task:', hasThirdTask);

if (hasFirstTask && hasSecondTask && hasThirdTask) {
  console.log('✅ All tasks are present');
  return { success: true, content };
} else {
  console.log('❌ Some tasks are missing');
  return { success: false, content };
}
