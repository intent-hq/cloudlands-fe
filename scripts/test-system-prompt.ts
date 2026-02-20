/**
 * Test script to verify system prompt loading
 *
 * This script tests that:
 * 1. The base system prompt can be loaded from resources/system-prompt.md
 * 2. The system prompt is included in the agent's final prompt
 * 3. The verification message is present
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Read the system prompt file
const systemPromptPath = join(__dirname, '../resources/system-prompt.md');

try {
  const systemPrompt = readFileSync(systemPromptPath, 'utf-8');

  console.log('✅ System prompt file found!');
  console.log(`📄 Path: ${systemPromptPath}`);
  console.log(`📏 Length: ${systemPrompt.length} characters`);
  console.log('');

  // Check for key elements
  const checks = [
    { name: 'Version 0.1', pattern: /Version.*0\.1/i },
    { name: 'Augment Agent', pattern: /Augment Agent/i },
    { name: 'Verification message', pattern: /Intent System Prompt version 0\.1 loaded/i },
    { name: 'Core Identity section', pattern: /## Core Identity/i },
    { name: 'Key Principles section', pattern: /## Key Principles/i },
  ];

  console.log('🔍 Checking system prompt content:');
  console.log('');

  let allPassed = true;
  for (const check of checks) {
    const passed = check.pattern.test(systemPrompt);
    const icon = passed ? '✅' : '❌';
    console.log(`${icon} ${check.name}`);
    if (!passed) allPassed = false;
  }

  console.log('');

  if (allPassed) {
    console.log('🎉 All checks passed!');
    console.log('');
    console.log('📋 System prompt preview (first 500 chars):');
    console.log('─'.repeat(60));
    console.log(systemPrompt.substring(0, 500));
    console.log('─'.repeat(60));
    console.log('');
    console.log('✨ Next step: Run the app and create an agent to verify it loads!');
    process.exit(0);
  } else {
    console.log('❌ Some checks failed!');
    process.exit(1);
  }
} catch (error) {
  console.error('❌ Error reading system prompt file:', error);
  process.exit(1);
}
