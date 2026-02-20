/**
 * Test script for CDP Accessibility Tree functionality
 *
 * This tests the accessibility tree retrieval directly via CDP,
 * simulating what the cdp_get_accessibility_tree MCP tool will do.
 *
 * Usage:
 *   pnpm tsx test/test-accessibility-tree.ts
 *
 * Prerequisites:
 *   - Electron app running with CDP enabled on port 9222
 *   - Run: pnpm run dev:cdp
 */

import CDP from 'chrome-remote-interface';

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  metadata?: any;
}

class AccessibilityTreeTestHarness {
  private client: any;
  private results: TestResult[] = [];

  async connect() {
    const port = parseInt(process.env.CDP_PORT || '9222', 10);
    console.log(`\n🔌 Connecting to CDP on port ${port}...`);

    try {
      this.client = await CDP({ port });
      await this.client.Runtime.enable();
      await this.client.DOM.enable();
      await this.client.Accessibility.enable();
      console.log('✅ Connected to CDP and enabled Accessibility domain\n');
    } catch (error: any) {
      console.error(`❌ Failed to connect: ${error.message}`);
      console.error('   Make sure Electron is running with: pnpm run dev:cdp');
      process.exit(1);
    }
  }

  async disconnect() {
    if (this.client) {
      await this.client.close();
    }
  }

  async runTest(name: string, testFn: () => Promise<any>): Promise<void> {
    console.log(`🧪 ${name}`);

    try {
      const result = await testFn();
      this.results.push({
        name,
        passed: true,
        metadata: result,
      });
      console.log('   ✅ PASS');
      if (result) {
        console.log(`   📊 ${JSON.stringify(result)}`);
      }
    } catch (error: any) {
      this.results.push({
        name,
        passed: false,
        error: error.message,
      });
      console.log(`   ❌ FAIL: ${error.message}`);
    }
    console.log('');
  }

  async testFullAccessibilityTree() {
    await this.runTest('Get full accessibility tree', async () => {
      const { nodes } = await this.client.Accessibility.getFullAXTree();

      if (!nodes || nodes.length === 0) {
        throw new Error('No nodes returned');
      }

      return {
        nodeCount: nodes.length,
        sample: nodes.slice(0, 3).map((n: any) => ({
          role: n.role?.value,
          name: n.name?.value,
          nodeId: n.nodeId,
        })),
      };
    });
  }

  async testFullAccessibilityTreeWithDepth() {
    await this.runTest('Get full accessibility tree with depth limit', async () => {
      const { nodes } = await this.client.Accessibility.getFullAXTree({ depth: 2 });

      if (!nodes || nodes.length === 0) {
        throw new Error('No nodes returned');
      }

      return {
        nodeCount: nodes.length,
        depth: 2,
      };
    });
  }

  async testPartialAccessibilityTree() {
    await this.runTest('Get partial accessibility tree for specific element', async () => {
      // First, find a button element
      const result = await this.client.Runtime.evaluate({
        expression: 'document.querySelector(\'button\')',
        returnByValue: false,
      });

      if (result.exceptionDetails) {
        throw new Error(`Script error: ${result.exceptionDetails.text}`);
      }

      if (result.result.type === 'undefined' || result.result.subtype === 'null') {
        throw new Error('No button found on page');
      }

      // Get accessibility tree for this button
      const { nodes } = await this.client.Accessibility.getPartialAXTree({
        objectId: result.result.objectId,
        fetchRelatives: false,
      });

      if (!nodes || nodes.length === 0) {
        throw new Error('No nodes returned for button');
      }

      return {
        nodeCount: nodes.length,
        buttonNode: {
          role: nodes[0].role?.value,
          name: nodes[0].name?.value,
          focusable: nodes[0].properties?.find((p: any) => p.name === 'focusable')?.value?.value,
        },
      };
    });
  }

  async testPartialAccessibilityTreeWithRelatives() {
    await this.runTest('Get partial accessibility tree with relatives', async () => {
      // Find a button element
      const result = await this.client.Runtime.evaluate({
        expression: 'document.querySelector(\'button\')',
        returnByValue: false,
      });

      if (result.result.type === 'undefined' || result.result.subtype === 'null') {
        throw new Error('No button found on page');
      }

      // Get accessibility tree with relatives
      const { nodes } = await this.client.Accessibility.getPartialAXTree({
        objectId: result.result.objectId,
        fetchRelatives: true,
      });

      if (!nodes || nodes.length === 0) {
        throw new Error('No nodes returned');
      }

      return {
        nodeCount: nodes.length,
        hasMoreThanTarget: nodes.length > 1, // Should include relatives
      };
    });
  }

  async testAccessibilityTreeForDialog() {
    await this.runTest('Get accessibility tree for dialog/modal (if present)', async () => {
      // Try to find a dialog or modal
      const result = await this.client.Runtime.evaluate({
        expression: 'document.querySelector(\'[role="dialog"], dialog, .modal\')',
        returnByValue: false,
      });

      if (result.result.type === 'undefined' || result.result.subtype === 'null') {
        // No dialog present, skip test
        return { skipped: true, reason: 'No dialog found on page' };
      }

      // Get accessibility tree for dialog
      const { nodes } = await this.client.Accessibility.getPartialAXTree({
        objectId: result.result.objectId,
        fetchRelatives: false,
      });

      return {
        nodeCount: nodes.length,
        dialogNode: {
          role: nodes[0].role?.value,
          name: nodes[0].name?.value,
        },
      };
    });
  }

  async testAccessibilityPropertiesDetail() {
    await this.runTest('Verify accessibility node structure and properties', async () => {
      const { nodes } = await this.client.Accessibility.getFullAXTree({ depth: 1 });

      if (!nodes || nodes.length === 0) {
        throw new Error('No nodes returned');
      }

      // Find a node with interesting properties
      const interactiveNode = nodes.find(
        (n: any) =>
          n.role?.value === 'button' || n.role?.value === 'link' || n.role?.value === 'textbox',
      );

      if (!interactiveNode) {
        return { skipped: true, reason: 'No interactive elements found' };
      }

      return {
        nodeId: interactiveNode.nodeId,
        role: interactiveNode.role?.value,
        name: interactiveNode.name?.value,
        hasProperties: interactiveNode.properties && interactiveNode.properties.length > 0,
        propertyCount: interactiveNode.properties?.length || 0,
        sampleProperties: interactiveNode.properties?.slice(0, 3).map((p: any) => p.name),
      };
    });
  }

  printSummary() {
    console.log(`\n${  '='.repeat(60)}`);
    console.log('📊 TEST SUMMARY');
    console.log('='.repeat(60));

    const passed = this.results.filter((r) => r.passed).length;
    const failed = this.results.filter((r) => !r.passed).length;
    const total = this.results.length;

    console.log(`\nTotal: ${total} | Passed: ${passed} | Failed: ${failed}\n`);

    if (failed > 0) {
      console.log('❌ Failed tests:');
      this.results
        .filter((r) => !r.passed)
        .forEach((r) => {
          console.log(`   - ${r.name}`);
          console.log(`     Error: ${r.error}`);
        });
      console.log('');
    }

    if (passed === total) {
      console.log('✅ All tests passed!\n');
    }
  }
}

async function main() {
  const harness = new AccessibilityTreeTestHarness();

  try {
    await harness.connect();

    // Run all tests
    await harness.testFullAccessibilityTree();
    await harness.testFullAccessibilityTreeWithDepth();
    await harness.testPartialAccessibilityTree();
    await harness.testPartialAccessibilityTreeWithRelatives();
    await harness.testAccessibilityTreeForDialog();
    await harness.testAccessibilityPropertiesDetail();

    harness.printSummary();
  } catch (error: any) {
    console.error(`\n❌ Test harness error: ${error.message}`);
    process.exit(1);
  } finally {
    await harness.disconnect();
  }
}

main();
