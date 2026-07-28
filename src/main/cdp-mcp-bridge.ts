/**
 * CDP MCP Bridge
 *
 * Exposes CDP debugging tools via HTTP MCP server.
 * Separate from HttpMcpBridge to maintain clear separation between
 * production workspace tools and development debugging tools.
 *
 * This server only runs when:
 * - NODE_ENV=development
 * - ENABLE_CDP_DEBUG=true
 */

import express, { Request, Response } from 'express';
import { Logger } from '../shared/logger';
import { createCdpMCPServer } from '../features/cdp';
import type { Server } from 'http';
import type { MCPServer } from '../features/mcp/main/mcp/server';

export class CdpMcpBridge {
  private app: express.Application;
  private server: Server | null = null;
  private mcpServer: MCPServer | null = null;
  private logger: Logger;
  private port: number;
  private cdpPort: number = 9223;

  constructor(port: number = 9223) {
    this.port = port;
    this.logger = new Logger('CdpMcpBridge');
    this.app = express();
    this.app.use(express.json());
    this.setupRoutes();
  }

  private setupRoutes(): void {
    // Health check endpoint
    this.app.get('/health', (req: Request, res: Response) => {
      const tools = this.mcpServer ? this.mcpServer.getTools().map((t: any) => t.name) : [];

      res.json({
        status: 'ok',
        service: 'cdp-mcp-bridge',
        timestamp: new Date().toISOString(),
        cdpPort: this.cdpPort,
        port: this.port,
        tools,
      });
    });

    // MCP endpoint
    this.app.post('/mcp', async (req: Request, res: Response) => {
      if (!this.mcpServer) {
        res.status(503).json({
          jsonrpc: '2.0',
          error: {
            code: -32000,
            message: 'CDP MCP Server not initialized',
          },
          id: req.body?.id || null,
        });
        return;
      }

      try {
        const jsonRpcRequest = req.body;

        this.logger.debug('Received CDP MCP request', {
          method: jsonRpcRequest.method,
          id: jsonRpcRequest.id,
        });

        const response = await this.mcpServer.handleMessage(jsonRpcRequest);

        if (response) {
          res.json(response);
          this.logger.debug('Sent CDP MCP response', {
            id: response.id,
            hasError: !!(response as any).error,
          });
        } else {
          res.status(204).send();
        }
      } catch (error) {
        this.logger.error('Error handling CDP MCP request:', error);

        const errorResponse = {
          jsonrpc: '2.0',
          error: {
            code: -32603,
            // i18n-ignore (MCP wire-protocol error consumed by agents)
            message: 'Internal server error',
            data: (error as Error).message,
          },
          id: req.body?.id || null,
        };

        res.status(500).json(errorResponse);
      }
    });
  }

  /**
   * Start the server with automatic port conflict handling
   */
  async start(): Promise<void> {
    // Create and initialize CDP MCP server first
    let mcpServer: MCPServer;
    try {
      // Get CDP port from environment or use default
      this.cdpPort = parseInt(process.env.CDP_PORT || '9223', 10);
      mcpServer = await createCdpMCPServer(this.cdpPort);
      this.mcpServer = mcpServer;
      const tools = mcpServer.getTools().map((t: any) => t.name);
      this.logger.debug(`CDP MCP Server initialized with tools: ${tools.join(', ')}`);
    } catch (error) {
      this.logger.error('Failed to initialize CDP MCP Server:', error);
      throw error;
    }

    // Start HTTP server with port conflict handling
    let currentPort = this.port;
    let attempts = 0;
    const maxAttempts = 10;

    while (attempts < maxAttempts) {
      try {
        await this.tryStartServer(currentPort);
        this.port = currentPort; // Update to actual port used
        const tools = mcpServer.getTools();
        console.log(`\n🔧 CDP MCP Bridge: http://localhost:${this.port} (${tools.length} tools)\n`);
        return;
      } catch (error) {
        const errnoError = error as NodeJS.ErrnoException;
        if (errnoError.code === 'EADDRINUSE') {
          this.logger.debug(`Port ${currentPort} is in use, trying ${currentPort + 1}`);
          currentPort++;
          attempts++;
        } else {
          throw error;
        }
      }
    }

    throw new Error(
      // i18n-ignore (developer diagnostic error)
      `Could not find available port after ${maxAttempts} attempts starting from ${this.port}`,
    );
  }

  /**
   * Try to start the server on a specific port
   */
  private tryStartServer(port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const server = this.app.listen(port, 'localhost');

      server.once('error', (error: any) => {
        server.close();
        reject(error);
      });

      server.once('listening', () => {
        this.server = server;
        resolve();
      });
    });
  }

  /**
   * Stop the server
   */
  async stop(): Promise<void> {
    const server = this.server;
    if (server) {
      return new Promise((resolve) => {
        server.close(() => {
          this.logger.info('CDP MCP Bridge stopped');
          resolve();
        });
      });
    }
  }

  /**
   * Get the actual port the server is running on
   */
  getPort(): number {
    return this.port;
  }
}
