/**
 * Test Monaco Diff Viewer with hideUnchangedRegions
 * Run in watch mode: tsx watch test/test-diff-viewer.ts
 */

import CDP from 'chrome-remote-interface';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TEST_HTML_PATH = path.join(__dirname, 'diff-viewer-test.html');
const TEST_URL = `file://${TEST_HTML_PATH}`;

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function testDiffViewer() {
  console.log('🔍 Testing Monaco Diff Viewer...\n');
  console.log(`📄 Test file: ${TEST_HTML_PATH}`);
  console.log('🌐 Open this URL in Chrome with --remote-debugging-port=9223:');
  console.log(`   ${TEST_URL}\n`);
  console.log('💡 Or run this command:');
  console.log(`   open -a "Google Chrome" --args --remote-debugging-port=9223 "${TEST_URL}"\n`);
  console.log('⏳ Waiting for connection on port 9223...\n');

  let client;
  let retries = 30;
  while (retries > 0) {
    try {
      client = await CDP({ port: 9223 });
      break;
    } catch (e) {
      retries--;
      if (retries === 0) {
        console.error('\n❌ Could not connect to Chrome.');
        console.error('   Make sure Chrome is running with --remote-debugging-port=9223');
        console.log('\nℹ️  No CDP endpoint is available; skipping diff viewer CDP tests.');
        return;
      }
      await sleep(1000);
    }
  }

  try {
    const { Runtime, DOM, Accessibility } = client;

    await Runtime.enable();
    await DOM.enable();
    await Accessibility.enable();

    console.log('✅ Connected to Chrome\n');

    // Wait for Monaco to load
    console.log('⏳ Waiting for Monaco to load...');
    await sleep(3000);

    // Test 1: Check if editor was created
    console.log('\n📊 Test 1: Check Editor Creation');
    const editorCheck = await Runtime.evaluate({
      expression: 'window.editorInfo',
      returnByValue: true,
    });
    console.log('Editor Info:', editorCheck.result.value);

    // Test 2: Inspect the DOM structure
    console.log('\n📊 Test 2: Inspect DOM Structure');
    const domCheck = await Runtime.evaluate({
      expression: `
        const container = document.getElementById('container');
        const diffEditor = container?.querySelector('.monaco-diff-editor');
        const sideBySide = container?.querySelector('.side-by-side');
        const originalEditor = container?.querySelector('.original-in-monaco-diff-editor');
        const modifiedEditor = container?.querySelector('.modified-in-monaco-diff-editor');

        ({
          hasContainer: !!container,
          hasDiffEditor: !!diffEditor,
          hasSideBySide: !!sideBySide,
          hasOriginalEditor: !!originalEditor,
          hasModifiedEditor: !!modifiedEditor,
          containerClasses: container?.className,
          diffEditorClasses: diffEditor?.className,
        })
      `,
      returnByValue: true,
    });
    console.log('DOM Structure:', JSON.stringify(domCheck.result.value, null, 2));

    // Test 3: Check for diff decorations
    console.log('\n📊 Test 3: Check Diff Decorations');
    const decorationsCheck = await Runtime.evaluate({
      expression: `
        const container = document.getElementById('container');
        const insertDecorations = container?.querySelectorAll('.line-insert');
        const deleteDecorations = container?.querySelectorAll('.line-delete');
        const charInserts = container?.querySelectorAll('.char-insert');
        const charDeletes = container?.querySelectorAll('.char-delete');

        ({
          insertLines: insertDecorations?.length || 0,
          deleteLines: deleteDecorations?.length || 0,
          charInserts: charInserts?.length || 0,
          charDeletes: charDeletes?.length || 0,
        })
      `,
      returnByValue: true,
    });
    console.log('Decorations:', decorationsCheck.result.value);

    // Test 4: Check hideUnchangedRegions elements
    console.log('\n📊 Test 4: Check hideUnchangedRegions Elements');
    const hideUnchangedCheck = await Runtime.evaluate({
      expression: `
        const container = document.getElementById('container');
        const unchangedRegions = container?.querySelectorAll('.monaco-diff-hidden-lines');
        const collapseButtons = container?.querySelectorAll('.monaco-diff-hidden-lines-widget');

        ({
          unchangedRegionCount: unchangedRegions?.length || 0,
          collapseButtonCount: collapseButtons?.length || 0,
          unchangedRegionClasses: Array.from(unchangedRegions || []).map(el => el.className),
        })
      `,
      returnByValue: true,
    });
    console.log('Hide Unchanged Regions:', JSON.stringify(hideUnchangedCheck.result.value, null, 2));

    // Test 5: Get editor options
    console.log('\n📊 Test 5: Check Editor Options');
    const optionsCheck = await Runtime.evaluate({
      expression: `
        window.editor?.getOptions?.()?.get?.(monaco.editor.EditorOption.hideUnchangedRegions)
      `,
      returnByValue: true,
    });
    console.log('hideUnchangedRegions option:', optionsCheck.result.value);

    // Test 6: Try large diff
    console.log('\n📊 Test 6: Testing Large Diff');
    await Runtime.evaluate({
      expression: 'testLargeDiff()',
      awaitPromise: true,
    });
    await sleep(1000);

    const largeDiffCheck = await Runtime.evaluate({
      expression: `
        const container = document.getElementById('container');
        const unchangedRegions = container?.querySelectorAll('.monaco-diff-hidden-lines');
        ({
          unchangedRegionCount: unchangedRegions?.length || 0,
        })
      `,
      returnByValue: true,
    });
    console.log('Large Diff - Unchanged Regions:', largeDiffCheck.result.value);

    console.log('\n✅ Tests complete!');
    if (process.env.KEEP_DIFF_VIEWER_OPEN === 'true') {
      console.log('\n💡 Chrome window left open for manual inspection');
      console.log('   Close Chrome to exit this script');
      await new Promise(() => {});
    }

  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

testDiffViewer().catch(console.error);
