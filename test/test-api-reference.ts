#!/usr/bin/env tsx

/**
 * Test the cdp_api_reference tool
 *
 * This test verifies that the API reference tool returns comprehensive documentation.
 */

import { spawn } from 'child_process';
import * as readline from 'readline';
import CDP from 'chrome-remote-interface';

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: any;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number;
  result?: any;
  error?: any;
}

class MCPTestClient {
  private process: any;
  private rl: readline.Interface;
  private responseHandlers: Map<number, (response: JsonRpcResponse) => void> = new Map();
  private nextId = 1;

  async start() {
    console.log('Starting MCP server...');

    this.process = spawn('node', ['cdp-mcp-server/dist/server.cjs'], {
      stdio: ['pipe', 'pipe', 'inherit'],
      env: { ...process.env, CDP_PORT: '9223' },
    });

    this.rl = readline.createInterface({
      input: this.process.stdout,
      crlfDelay: Infinity,
    });

    this.rl.on('line', (line) => {
      try {
        const response: JsonRpcResponse = JSON.parse(line);
        const handler = this.responseHandlers.get(response.id);
        if (handler) {
          handler(response);
          this.responseHandlers.delete(response.id);
        }
      } catch (error) {
        console.error('Failed to parse response:', line);
      }
    });

    // Initialize
    await this.call('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'test-client', version: '1.0.0' },
    });

    console.log('MCP server started\n');
  }

  async call(method: string, params?: any): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const request: JsonRpcRequest = {
        jsonrpc: '2.0',
        id,
        method,
        params,
      };

      this.responseHandlers.set(id, (response) => {
        if (response.error) {
          reject(new Error(response.error.message || 'Unknown error'));
        } else {
          resolve(response.result);
        }
      });

      this.process.stdin.write(`${JSON.stringify(request)  }\n`);
    });
  }

  async stop() {
    this.process.kill();
  }
}

async function main() {
  const port = parseInt(process.env.CDP_PORT || '9223', 10);
  try {
    const probe = await CDP({ port });
    await probe.close();
  } catch (error: any) {
    console.error(`❌ Failed to connect to CDP: ${error.message}`);
    console.error(`   Make sure Electron is running with --remote-debugging-port=${port}`);
    console.log('\nℹ️  No CDP endpoint is available; skipping API reference MCP test.');
    return;
  }

  const client = new MCPTestClient();

  try {
    await client.start();

    console.log('=== Test: cdp_api_reference ===\n');

    const result = await client.call('tools/call', {
      name: 'cdp_api_reference',
      arguments: {},
    });

    const content = result.content[0].text;

    // Verify key sections are present
    const requiredSections = [
      '# CDP Tools API Reference',
      '## cdp_run_script - Playwright-Style API',
      'cdp.getByRole',
      'cdp.getByText',
      'cdp.locator',
      'locator.click',
      'locator.fill',
      'cdp.waitForURL',
      'cdp.storage',
      '## cdp_get_accessibility_tree',
      '## cdp_get_dom',
      '## Best Practices',
      '## Complete Example',
    ];

    let allPresent = true;
    for (const section of requiredSections) {
      if (!content.includes(section)) {
        console.log(`❌ Missing section: ${section}`);
        allPresent = false;
      }
    }

    if (allPresent) {
      console.log('✅ All required sections present');
      console.log(`✅ Documentation length: ${content.length} characters`);
      console.log('\n=== Sample from documentation ===\n');

      // Show a sample
      const lines = content.split('\n');
      console.log(lines.slice(0, 20).join('\n'));
      console.log('\n... (truncated) ...\n');

      console.log('\n✅ API reference tool working correctly!');
    } else {
      console.log('\n❌ Some sections missing from documentation');
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  } finally {
    await client.stop();
  }
}

main();
