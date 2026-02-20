/**
 * Run Script Tool
 *
 * Executes arbitrary JavaScript code in the renderer process via CDP.
 * Returns the result with type information and handles errors gracefully.
 */

import { BaseMCPTool } from '../../mcp/main/mcp/tool';
import { ToolCall, ToolResult } from '../../mcp/main/mcp/protocol';
import { CdpConnectionManager } from '../cdp-connection';

export class RunScriptTool extends BaseMCPTool {
  constructor(private connectionManager: CdpConnectionManager) {
    super(
      'cdp.run_script',
      'Execute JavaScript code in the renderer process. Returns the result with type information.',
      {
        type: 'object',
        properties: {
          script: {
            type: 'string',
            description:
              'JavaScript code to execute in the page context. Can access DOM, window, and all page variables.',
          },
        },
        required: ['script'],
      },
    );
  }

  async execute(call: ToolCall): Promise<ToolResult> {
    try {
      const { script } = call.arguments as { script: string };

      if (!script || typeof script !== 'string') {
        return this.error('Script parameter is required and must be a string');
      }

      const client = this.connectionManager.getClient();

      const result = await client.Runtime.evaluate({
        expression: script,
        returnByValue: true,
        awaitPromise: true,
      });

      // Handle script execution errors
      if (result.exceptionDetails) {
        const exception = result.exceptionDetails;
        const errorMessage = exception.exception?.description || exception.text || 'Unknown error';
        const location =
          exception.lineNumber !== undefined && exception.columnNumber !== undefined
            ? `\nLine: ${exception.lineNumber + 1}, Column: ${exception.columnNumber + 1}`
            : '';

        return this.error(`Script execution failed: ${errorMessage}${location}`);
      }

      // Format the result based on type
      const value = result.result.value;
      const type = result.result.type;
      const subtype = result.result.subtype;

      let formattedResult: string;

      if (type === 'undefined') {
        formattedResult = 'undefined';
      } else if (type === 'object' && subtype === 'null') {
        formattedResult = 'null';
      } else if (type === 'object' || type === 'array') {
        formattedResult = JSON.stringify(value, null, 2);
      } else if (type === 'string') {
        formattedResult = value;
      } else {
        formattedResult = String(value);
      }

      return this.success(`Result (${type}${subtype ? `:${subtype}` : ''}):\n${formattedResult}`, {
        type,
        subtype,
        value,
      });
    } catch (error) {
      return this.error(`CDP error: ${(error as Error).message}`);
    }
  }
}
