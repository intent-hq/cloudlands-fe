/**
 * Electron UI Test Runner
 *
 * Run this directly in the Electron app's DevTools console to test UI rendering
 * This script runs automated tests within the actual Electron environment
 */

(async function () {
  console.log('%c🧪 Electron UI Test Runner', 'color: #2196F3; font-weight: bold; font-size: 16px');

  const results = {
    passed: [],
    failed: [],
    warnings: [],
  };

  // Test utilities
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const waitForElement = async (selector, timeout = 5000) => {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const element = document.querySelector(selector);
      if (element) return element;
      await wait(100);
    }
    throw new Error(`Element ${selector} not found within ${timeout}ms`);
  };

  const waitForCondition = async (condition, timeout = 5000) => {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (condition()) return true;
      await wait(100);
    }
    throw new Error(`Condition not met within ${timeout}ms`);
  };

  const test = async (name, fn) => {
    try {
      console.log(`Running: ${name}`);
      await fn();
      results.passed.push(name);
      console.log(`✅ ${name}`);
    } catch (error) {
      results.failed.push({ name, error: error.message });
      console.error(`❌ ${name}:`, error.message);
    }
  };

  const sendMessage = async (content) => {
    const input = document.querySelector(
      '[data-testid="message-input"], .message-input textarea, input[type="text"]',
    );
    if (!input) throw new Error('Message input not found');

    input.value = content;
    input.dispatchEvent(new Event('input', { bubbles: true }));

    const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true });
    input.dispatchEvent(event);

    // Wait for message to be sent
    await wait(100);
  };

  // Tests
  console.log('\n📋 Starting UI Tests...\n');

  // Test 1: Streaming Cursor
  await test('Streaming cursor appears immediately', async () => {
    await sendMessage('Test streaming cursor');

    // Cursor should appear within 500ms
    const cursor = await waitForElement('.streaming-cursor, .cursor, [data-streaming="true"]', 500);
    if (!cursor) throw new Error('Streaming cursor did not appear');

    // Check for animation
    const hasAnimation =
      cursor.classList.contains('animate-pulse') ||
      cursor.classList.contains('animate') ||
      getComputedStyle(cursor).animation !== 'none';
    if (!hasAnimation) {
      results.warnings.push('Cursor has no animation');
    }
  });

  // Test 2: Progressive Text Rendering
  await test('Text renders progressively during streaming', async () => {
    await sendMessage('Tell me about JavaScript');

    // Wait for streaming to start
    await waitForElement('[data-streaming="true"]', 1000);

    // Monitor text changes
    const messageElement = document.querySelector(
      '[data-message-role="assistant"]:last-child, .assistant-message:last-child',
    );
    if (!messageElement) throw new Error('Assistant message element not found');

    const textSnapshots = [];
    for (let i = 0; i < 5; i++) {
      await wait(200);
      const text = messageElement.textContent || '';
      textSnapshots.push(text.length);
    }

    // Check that text is growing
    const isGrowing = textSnapshots.every((len, i) => i === 0 || len >= textSnapshots[i - 1]);
    if (!isGrowing) throw new Error('Text is not rendering progressively');

    // Check that we saw actual growth
    const totalGrowth = textSnapshots[textSnapshots.length - 1] - textSnapshots[0];
    if (totalGrowth < 10) throw new Error('Text growth too small, might not be streaming');
  });

  // Test 3: No Flickering
  await test('No flickering during streaming', async () => {
    await sendMessage('Write a short paragraph');

    // Wait for streaming
    await waitForElement('[data-streaming="true"]', 1000);

    const messageElement = document.querySelector('[data-message-role="assistant"]:last-child');
    if (!messageElement) throw new Error('Message element not found');

    // Monitor for element recreation (flickering)
    const initialElement = messageElement;
    let flickerDetected = false;

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'childList') {
          // Check if the message element was removed and re-added
          if (Array.from(mutation.removedNodes).includes(initialElement)) {
            flickerDetected = true;
          }
        }
      }
    });

    observer.observe(messageElement.parentElement, { childList: true });

    // Watch for 2 seconds
    await wait(2000);
    observer.disconnect();

    if (flickerDetected) throw new Error('Flickering detected during streaming');
  });

  // Test 4: Markdown Rendering
  await test('Markdown renders correctly during streaming', async () => {
    await sendMessage('Show me markdown with **bold** and `code`');

    // Wait for response to complete
    await wait(3000);

    const messageElement = document.querySelector('[data-message-role="assistant"]:last-child');
    if (!messageElement) throw new Error('Message element not found');

    // Check for rendered markdown elements
    const hasBold = messageElement.querySelector('strong, b');
    const hasCode = messageElement.querySelector('code');

    if (!hasBold) throw new Error('Bold markdown not rendered');
    if (!hasCode) throw new Error('Code markdown not rendered');

    // Check that raw markdown is not visible
    const text = messageElement.textContent || '';
    if (text.includes('**') || text.includes('`')) {
      results.warnings.push('Raw markdown symbols visible');
    }
  });

  // Test 5: Streaming Completion
  await test('Streaming indicators removed after completion', async () => {
    // Wait for any active streaming to complete
    await waitForCondition(() => document.querySelectorAll('[data-streaming="true"]').length === 0, 30000);

    // Check no streaming indicators remain
    const streamingElements = document.querySelectorAll(
      '[data-streaming="true"], .streaming-cursor, .streaming',
    );
    if (streamingElements.length > 0) {
      throw new Error(`${streamingElements.length} streaming indicators still present`);
    }
  });

  // Test 6: Message Persistence
  await test('Messages persist in DOM', async () => {
    // Count current messages
    const messagesBefore = document.querySelectorAll('[data-message-id]').length;

    // Send a new message
    await sendMessage('Persistence test message');
    await wait(2000);

    // Count messages after
    const messagesAfter = document.querySelectorAll('[data-message-id]').length;

    if (messagesAfter <= messagesBefore) {
      throw new Error('New message not added to DOM');
    }

    // Check message content is preserved
    const lastMessage = Array.from(document.querySelectorAll('[data-message-role="user"]')).pop();
    if (!lastMessage?.textContent?.includes('Persistence test message')) {
      throw new Error('Message content not preserved correctly');
    }
  });

  // Test 7: IPC Communication
  await test('IPC communication working', async () => {
    // Check if we're in Electron
    if (!window.require) {
      results.warnings.push('Not running in Electron environment');
      return;
    }

    const { ipcRenderer } = require('electron');
    let receivedChunk = false;

    // Listen for IPC messages
    const listener = (event, data) => {
      receivedChunk = true;
    };

    ipcRenderer.on('agent:stream:chunk', listener);

    // Send a message
    await sendMessage('Test IPC communication');

    // Wait for IPC message
    await wait(2000);

    ipcRenderer.removeListener('agent:stream:chunk', listener);

    if (!receivedChunk) {
      throw new Error('No IPC streaming chunks received');
    }
  });

  // Test 8: Memory Usage
  await test('Memory usage reasonable', async () => {
    if (!performance.memory) {
      results.warnings.push('Memory API not available');
      return;
    }

    const memoryMB = performance.memory.usedJSHeapSize / 1048576;
    console.log(`Current memory usage: ${memoryMB.toFixed(2)} MB`);

    if (memoryMB > 500) {
      throw new Error(`High memory usage: ${memoryMB.toFixed(2)} MB`);
    }

    if (memoryMB > 300) {
      results.warnings.push(`Memory usage elevated: ${memoryMB.toFixed(2)} MB`);
    }
  });

  // Test 9: DOM Node Count
  await test('DOM node count reasonable', async () => {
    const nodeCount = document.querySelectorAll('*').length;
    console.log(`DOM nodes: ${nodeCount}`);

    if (nodeCount > 10000) {
      throw new Error(`Too many DOM nodes: ${nodeCount}`);
    }

    if (nodeCount > 5000) {
      results.warnings.push(`High DOM node count: ${nodeCount}`);
    }
  });

  // Test 10: Scroll Performance
  await test('Scrolling works smoothly', async () => {
    const scrollContainer = document.querySelector(
      '[data-scroll-container], .scroll-container, .message-list',
    );
    if (!scrollContainer) {
      results.warnings.push('Scroll container not found');
      return;
    }

    // Check if scrollable
    const isScrollable = scrollContainer.scrollHeight > scrollContainer.clientHeight;
    if (!isScrollable) {
      console.log('Not enough content to test scrolling');
      return;
    }

    // Test scroll
    const startTime = performance.now();
    scrollContainer.scrollTop = scrollContainer.scrollHeight / 2;
    await wait(100);
    scrollContainer.scrollTop = 0;
    await wait(100);
    scrollContainer.scrollTop = scrollContainer.scrollHeight;
    const endTime = performance.now();

    const scrollTime = endTime - startTime;
    if (scrollTime > 500) {
      throw new Error(`Slow scrolling: ${scrollTime.toFixed(2)}ms`);
    }
  });

  // Results Summary
  console.log(`\n${  '='.repeat(50)}`);
  console.log('%c📊 Test Results', 'color: #4CAF50; font-weight: bold; font-size: 14px');
  console.log('='.repeat(50));

  console.log(`\n✅ Passed: ${results.passed.length}`);
  results.passed.forEach((name) => console.log(`   • ${name}`));

  if (results.failed.length > 0) {
    console.log(`\n❌ Failed: ${results.failed.length}`);
    results.failed.forEach(({ name, error }) => {
      console.log(`   • ${name}`);
      console.log(`     Error: ${error}`);
    });
  }

  if (results.warnings.length > 0) {
    console.log(`\n⚠️  Warnings: ${results.warnings.length}`);
    results.warnings.forEach((warning) => console.log(`   • ${warning}`));
  }

  // Overall status
  const allPassed = results.failed.length === 0;
  const status = allPassed ? '✅ All tests passed!' : '❌ Some tests failed';
  const color = allPassed ? '#4CAF50' : '#f44336';

  console.log(`\n${  '='.repeat(50)}`);
  console.log(`%c${status}`, `color: ${color}; font-weight: bold; font-size: 16px`);
  console.log('='.repeat(50));

  // Return results for programmatic use
  return results;
})();
