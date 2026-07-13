import * as net from 'net';
import { Logger } from '../shared/logger';

const logger = new Logger('PortUtils');

/**
 * Find an available port starting from the given port number.
 * Prevents port conflicts during application startup by checking
 * sequential ports until an available one is found.
 *
 * @param startPort - The port number to start checking from
 * @param maxAttempts - Maximum number of ports to check (default: 10)
 * @returns The first available port number found
 * @throws Error if no available port is found within maxAttempts
 * @example
 * ```typescript
 * const port = await findAvailablePort(3000);
 * server.listen(port);
 * ```
 */
export async function findAvailablePort(
  startPort: number,
  maxAttempts: number = 10,
): Promise<number> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const port = startPort + attempt;
    const isAvailable = await isPortAvailable(port);

    if (isAvailable) {
      logger.info(`[PortUtils] Found available port: ${port}`);
      return port;
    }

    logger.debug(`[PortUtils] Port ${port} is in use, trying next...`);
  }

  throw new Error(
    `Could not find available port after ${maxAttempts} attempts starting from ${startPort}`,
  );
}

/**
 * Check if a specific port is available for binding.
 * Tests by attempting to create a server on the port.
 *
 * @param port - Port number to check
 * @returns Promise resolving to true if port is available, false otherwise
 */
function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();

    server.once('error', (err: any) => {
      if (err.code === 'EADDRINUSE') {
        resolve(false);
      } else {
        // Some other error, treat as unavailable
        resolve(false);
      }
    });

    server.once('listening', () => {
      server.close();
      resolve(true);
    });

    server.listen(port, '127.0.0.1');
  });
}

/**
 * Find available ports for multiple services simultaneously.
 * Ensures no conflicts between assigned ports and respects preferences.
 *
 * @param requests - Array of service names and their preferred ports
 * @returns Map of service names to assigned port numbers
 * @throws Error if unable to find available port for any service
 * @example
 * ```typescript
 * const ports = await findAvailablePorts([
 *   { name: 'web', preferredPort: 3000 },
 *   { name: 'api', preferredPort: 3001 },
 *   { name: 'ws', preferredPort: 3002 }
 * ]);
 * console.log(ports.get('web')); // 3000 (if available)
 * ```
 */
export async function findAvailablePorts(
  requests: { name: string; preferredPort: number }[],
): Promise<Map<string, number>> {
  const assignedPorts = new Map<string, number>();
  const usedPorts = new Set<number>();

  for (const { name, preferredPort } of requests) {
    let port = preferredPort;
    let attempts = 0;
    const maxAttempts = 20;

    while (attempts < maxAttempts) {
      if (!usedPorts.has(port) && (await isPortAvailable(port))) {
        assignedPorts.set(name, port);
        usedPorts.add(port);
        logger.info(`[PortUtils] Assigned port ${port} to ${name}`);
        break;
      }

      port++;
      attempts++;
    }

    if (!assignedPorts.has(name)) {
      throw new Error(`Could not find available port for ${name}`);
    }
  }

  return assignedPorts;
}
