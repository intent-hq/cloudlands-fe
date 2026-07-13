/**
 * Get DOM Tool
 *
 * Retrieves DOM structure as HTML. Can get the full document or a specific element
 * by CSS selector. Useful for inspecting the current page structure.
 */

import { BaseMCPTool } from '../../mcp/main/mcp/tool';
import {
  ToolCall,
  ToolResult,
} from '../../mcp/main/mcp/protocol';
import { CdpConnectionManager } from '../cdp-connection';

export class GetDomTool extends BaseMCPTool {
  constructor(private connectionManager: CdpConnectionManager) {
    super(
      'cdp.get_dom',
      'Get the DOM structure as HTML. Can retrieve full document or specific element by CSS selector.',
      {
        type: 'object',
        properties: {
          selector: {
            type: 'string',
            description:
              'Optional CSS selector to get specific element. If not provided, returns full document HTML.',
          },
        },
        required: [],
      },
    );
  }

  async execute(call: ToolCall): Promise<ToolResult> {
    try {
      const { selector } = call.arguments as { selector?: string };
      const client = this.connectionManager.getClient();

      if (selector) {
        // Get specific element by selector
        const result = await client.Runtime.evaluate({
          expression: `document.querySelector(${JSON.stringify(selector)})?.outerHTML || null`,
          returnByValue: true,
        });

        if (result.exceptionDetails) {
          return this.error(`Script error: ${result.exceptionDetails.text}`);
        }

        if (result.result.value === null) {
          return this.error(`No element found matching selector: ${selector}`);
        }

        return this.success(`HTML for selector "${selector}":\n\n${result.result.value}`, {
          selector,
          length: result.result.value.length,
        });
      } else {
        // Get full document
        const { root } = await client.DOM.getDocument({ depth: -1 });
        const { outerHTML } = await client.DOM.getOuterHTML({ nodeId: root.nodeId });

        return this.success(`Full document HTML:\n\n${outerHTML}`, { length: outerHTML.length });
      }
    } catch (error) {
      return this.error(`CDP error: ${(error as Error).message}`);
    }
  }
}
