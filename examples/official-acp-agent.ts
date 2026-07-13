/**
 * Example: Official ACP Agent Integration
 *
 * This example shows how to create an ACP-compatible agent
 * that works with the official Agent Client Protocol
 * from https://agentclientprotocol.com
 */

import { UniversalAgentManager } from '../src/features/agent/universal-agent-manager';
import type { AgentConfig } from '../src/features/agent/agent-providers/base-provider';

/**
 * Example 1: Using an ACP agent with STDIO
 */
async function useACPAgent(agentManager: UniversalAgentManager, workspaceId: string) {
  // Create an agent using the official ACP protocol
  const agent = await agentManager.createAgent(workspaceId, 'ACP Agent', {
    provider: 'acp',
    command: 'path/to/acp-agent', // Path to your ACP-compatible agent
    args: ['--stdio'], // Use stdio for communication
    workspaceId,
    workspacePath: '/path/to/workspace',
  });

  // Send a message to the agent
  const response = await agentManager.sendMessage(agent.id, 'List all files in the workspace');

  console.log('Agent response:', response.content);

  return agent;
}

/**
 * Example 2: Implementing a simple ACP agent (server side)
 *
 * This shows what your custom agent needs to implement
 * to be compatible with the official ACP protocol.
 */
class SimpleACPAgent {
  private sessions: Map<string, any> = new Map();
  private agentInfo = {
    name: 'Simple ACP Agent',
    version: '1.0.0',
    capabilities: ['session/prompt', 'session/load', 'session/set_mode'],
  };

  /**
   * Handle incoming JSON-RPC 2.0 messages
   */
  async handleMessage(message: string): Promise<string> {
    try {
      const request = JSON.parse(message);

      // Handle JSON-RPC 2.0 request
      if (request.jsonrpc !== '2.0') {
        return JSON.stringify({
          jsonrpc: '2.0',
          id: request.id || null,
          error: {
            code: -32600,
            message: 'Invalid Request',
          },
        });
      }

      let result;
      switch (request.method) {
        case 'initialize':
          result = await this.handleInitialize(request.params);
          break;

        case 'authenticate':
          result = await this.handleAuthenticate(request.params);
          break;

        case 'session/new':
          result = await this.handleNewSession(request.params);
          break;

        case 'session/prompt':
          result = await this.handlePrompt(request.params);
          break;

        case 'session/cancel':
          // Notification, no response needed
          await this.handleCancel(request.params);
          return '';

        default:
          return JSON.stringify({
            jsonrpc: '2.0',
            id: request.id,
            error: {
              code: -32601,
              message: `Method not found: ${request.method}`,
            },
          });
      }

      return JSON.stringify({
        jsonrpc: '2.0',
        id: request.id,
        result,
      });
    } catch (error: any) {
      return JSON.stringify({
        jsonrpc: '2.0',
        id: null,
        error: {
          code: -32700,
          message: 'Parse error',
          data: error.message,
        },
      });
    }
  }

  private async handleInitialize(params: any) {
    return {
      agentInfo: this.agentInfo,
      instructions: 'I am a simple ACP agent that can help with basic tasks.',
    };
  }

  private async handleAuthenticate(params: any) {
    // Simple authentication - always succeed
    return {
      success: true,
    };
  }

  private async handleNewSession(params: any) {
    const sessionId = Math.random().toString(36).substring(7);

    this.sessions.set(sessionId, {
      metadata: params.metadata,
      created: new Date(),
      messages: [],
    });

    return {
      sessionId,
      metadata: params.metadata,
    };
  }

  private async handlePrompt(params: any) {
    const session = this.sessions.get(params.sessionId);
    if (!session) {
      throw new Error(`Session not found: ${params.sessionId}`);
    }

    // Add messages to session history
    if (params.messages) {
      session.messages.push(...params.messages);
    }

    // Get the last user message
    const lastMessage = params.messages?.[params.messages.length - 1];
    if (!lastMessage || lastMessage.role !== 'user') {
      return {
        content: 'Please provide a user message.',
        stopReason: 'error',
      };
    }

    // Extract text content from the message
    const textContent = lastMessage.content
      .filter((c: any) => c.type === 'text')
      .map((c: any) => c.text)
      .join(' ');

    // Simple response logic
    let responseText = `I received your message: "${textContent}"`;

    // Check if user wants to read a file
    if (textContent.toLowerCase().includes('read') && textContent.toLowerCase().includes('file')) {
      // Send a request permission notification to the client
      responseText = 'To read files, I would need to request permission from the client.';
    }

    return {
      content: responseText,
      stopReason: 'complete',
    };
  }

  private async handleCancel(params: any) {
    // Handle session cancellation
    console.log(`Cancelling session: ${params.sessionId}`);
    // In a real implementation, you would cancel any ongoing operations
  }
}

/**
 * Example 3: Starting an ACP agent server
 *
 * This shows how to create a simple STDIO-based ACP agent server
 */
async function startACPAgentServer() {
  const agent = new SimpleACPAgent();

  // Read from stdin and write to stdout
  process.stdin.setEncoding('utf8');

  let buffer = '';

  process.stdin.on('data', async (chunk) => {
    buffer += chunk;

    // Process complete lines
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.trim()) {
        const response = await agent.handleMessage(line);
        if (response) {
          process.stdout.write(`${response}\n`);
        }
      }
    }
  });

  process.stdin.on('end', () => {
    process.exit(0);
  });
}

/**
 * Example 4: Client-side usage with the official ACP
 */
async function useOfficialACPProtocol() {
  // This would typically be handled by the ACPProvider class
  // but here's a simplified example of the protocol flow:

  const messages = [
    // Step 1: Initialize
    {
      jsonrpc: '2.0',
      method: 'initialize',
      params: {
        clientInfo: {
          name: 'Intent',
          version: '1.0.0',
        },
      },
      id: 1,
    },

    // Step 2: Authenticate
    {
      jsonrpc: '2.0',
      method: 'authenticate',
      params: {},
      id: 2,
    },

    // Step 3: Create session
    {
      jsonrpc: '2.0',
      method: 'session/new',
      params: {
        metadata: {
          workspaceId: 'workspace-123',
        },
      },
      id: 3,
    },

    // Step 4: Send prompt
    {
      jsonrpc: '2.0',
      method: 'session/prompt',
      params: {
        sessionId: 'session-abc', // From session/new response
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: 'Hello, can you help me?',
              },
            ],
          },
        ],
      },
      id: 4,
    },
  ];

  console.log('Official ACP protocol flow:', messages);
}

// Export for use in other modules
export { useACPAgent, SimpleACPAgent, startACPAgentServer, useOfficialACPProtocol };
