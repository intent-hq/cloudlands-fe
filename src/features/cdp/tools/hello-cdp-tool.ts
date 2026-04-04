/**
 * Hello CDP Tool
 *
 * Simple test tool that verifies CDP connection by retrieving the page title.
 * Useful for testing that the CDP connection is working correctly.
 */

import { BaseMCPTool } from '../../mcp/main/mcp/tool';
import { ToolCall, ToolResult } from '../../mcp/main/mcp/protocol';
import { CdpConnectionManager } from '../cdp-connection';

export class HelloCdpTool extends BaseMCPTool {
  constructor(private connectionManager: CdpConnectionManager) {
    super('cdp.hello', 'Test CDP connection by getting the page title', {
      type: 'object',
      properties: {},
      required: [],
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async execute(call: ToolCall): Promise<ToolResult> {
    try {
      const client = this.connectionManager.getClient();

      const result = await client.Runtime.evaluate({
        expression: 'document.title',
        returnByValue: true,
      });

      if (result.exceptionDetails) {
        return this.error(`Script error: ${result.exceptionDetails.text}`);
      }

      return this.success(`Page title: ${result.result.value}`);
    } catch (error) {
      return this.error(`CDP error: ${(error as Error).message}`);
    }
  }
}
