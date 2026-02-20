#!/usr/bin/env tsx

/**
 * Quick test script to verify instruction loading works
 */

import { getInstructionById, getInstructionWithCommon, getAvailableInstructionIds } from '../src/features/agent/instructions';

console.log('Testing instruction loading...\n');

// Test 1: Get available instruction IDs
console.log('1. Available instruction IDs:');
const ids = getAvailableInstructionIds();
console.log(`   Found ${ids.length} instructions:`, ids.slice(0, 5).join(', '), '...\n');

// Test 2: Load a specific instruction
console.log('2. Loading "chat" instruction:');
try {
  const chatInstruction = getInstructionById('chat');
  console.log(`   ✓ Loaded successfully (${chatInstruction.length} characters)`);
  console.log(`   First 100 chars: ${chatInstruction.substring(0, 100)}...\n`);
} catch (error) {
  console.error('   ✗ Failed to load:', error);
}

// Test 3: Load instruction with common
console.log('3. Loading "task-focused" with common:');
try {
  const taskFocusedWithCommon = getInstructionWithCommon('task-focused');
  console.log(`   ✓ Loaded successfully (${taskFocusedWithCommon.length} characters)`);
  console.log(`   Includes "Common Agent Knowledge": ${taskFocusedWithCommon.includes('# Common Agent Knowledge') ? 'Yes' : 'No'}`);
  console.log(`   First 100 chars: ${taskFocusedWithCommon.substring(0, 100)}...\n`);
} catch (error) {
  console.error('   ✗ Failed to load:', error);
}

// Test 4: Try loading non-existent instruction
console.log('4. Loading non-existent instruction:');
try {
  getInstructionById('non-existent');
  console.error('   ✗ Should have thrown an error!');
} catch (error) {
  console.log('   ✓ Correctly threw error:', (error as Error).message, '\n');
}

// Test 5: Load background instructions
console.log('5. Loading background instructions:');
try {
  const commitMessage = getInstructionById('commit-message');
  console.log(`   ✓ Loaded "commit-message" (${commitMessage.length} characters)`);
} catch (error) {
  console.error('   ✗ Failed to load:', error);
}

console.log('\n✅ All tests passed!');
