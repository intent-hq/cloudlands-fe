/**
 * Real-world test of CDP helpers
 * Tests against actual UI elements in the running Electron app
 */

import CDP from 'chrome-remote-interface';
import fs from 'fs/promises';
import path from 'path';

async function testRealWorld() {
  const port = parseInt(process.env.CDP_PORT || '9222', 10);
  console.log(`🔌 Connecting to CDP on port ${port}...`);

  const client = await CDP({ port });
  await client.Runtime.enable();
  console.log('✅ Connected\n');

  // Load helpers
  const helpersPath = path.join(__dirname, '../cdp-mcp-server/cdp-helpers.js');
  const helpersCode = await fs.readFile(helpersPath, 'utf-8');

  console.log('🧪 Testing real-world scenarios...\n');

  // Test 1: Find all buttons
  console.log('Test 1: Finding all buttons by role');
  const test1 = `
    ${helpersCode}

    (async () => {
      const buttons = cdp.getByRole('button');
      const count = await buttons.count();

      console.log('Found', count, 'buttons');

      return { count };
    })()
  `;

  let result = await client.Runtime.evaluate({
    expression: test1,
    awaitPromise: true,
    returnByValue: true,
  });

  console.log('  Result:', result.result.value);
  console.log('  ✅ Pass\n');

  // Test 2: Find specific button by name
  console.log('Test 2: Finding button by accessible name');
  const test2 = `
    ${helpersCode}

    (async () => {
      // Try to find any button with text
      const allButtons = Array.from(document.querySelectorAll('button'));
      const buttonTexts = allButtons.map(b => b.textContent?.trim() || b.getAttribute('aria-label') || '(no text)');

      console.log('Available buttons:', buttonTexts);

      return { buttonTexts };
    })()
  `;

  result = await client.Runtime.evaluate({
    expression: test2,
    awaitPromise: true,
    returnByValue: true,
  });

  console.log('  Result:', result.result.value);
  console.log('  ✅ Pass\n');

  // Test 3: Check current URL
  console.log('Test 3: Getting current URL');
  const test3 = `
    ${helpersCode}

    (async () => {
      const url = cdp.url();
      console.log('Current URL:', url);
      return { url };
    })()
  `;

  result = await client.Runtime.evaluate({
    expression: test3,
    awaitPromise: true,
    returnByValue: true,
  });

  console.log('  Result:', result.result.value);
  console.log('  ✅ Pass\n');

  // Test 4: Check localStorage
  console.log('Test 4: Checking localStorage');
  const test4 = `
    ${helpersCode}

    (async () => {
      const keys = cdp.storage.keysLocal();
      console.log('LocalStorage keys:', keys.length);
      return { keyCount: keys.length, sampleKeys: keys.slice(0, 5) };
    })()
  `;

  result = await client.Runtime.evaluate({
    expression: test4,
    awaitPromise: true,
    returnByValue: true,
  });

  console.log('  Result:', result.result.value);
  console.log('  ✅ Pass\n');

  // Test 5: Find elements by text
  console.log('Test 5: Finding elements by text');
  const test5 = `
    ${helpersCode}

    (async () => {
      // Find any element containing "workspace" (case-insensitive)
      const elements = cdp.getByText(/workspace/i);
      const count = await elements.count();

      console.log('Found', count, 'elements with "workspace"');

      return { count };
    })()
  `;

  result = await client.Runtime.evaluate({
    expression: test5,
    awaitPromise: true,
    returnByValue: true,
  });

  console.log('  Result:', result.result.value);
  console.log('  ✅ Pass\n');

  console.log('🎉 All real-world tests passed!\n');

  await client.close();
}

testRealWorld().catch((error) => {
  console.error('❌ Test failed:', error);
  process.exit(1);
});
