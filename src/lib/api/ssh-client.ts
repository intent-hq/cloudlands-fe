import { invoke } from '$lib/electron-bridge';

export interface SSHConnectionConfig {
  host: string;
  port: number;
  username: string;
  password?: string;
  privateKey?: string;
  privateKeyPath?: string;
  passphrase?: string;
  useAgent?: boolean;
  transport?: 'ssh' | 'websocket';
  wsUrl?: string;
}

/** Result of an SSH command execution */
export interface SSHCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface RemoteEnvironment {
  os: string;
  languages: string[];
  tools: string[];
}

export class SSHClient {
  /**
   * Connect to a remote server via SSH
   */
  async connect(
    id: string,
    config: SSHConnectionConfig,
  ): Promise<{
    id: string;
    connected: boolean;
    config: SSHConnectionConfig;
  }> {
    const response = (await invoke<any>('ssh:connect', { id, config })) as {
      success?: boolean;
      error?: string;
      data?: any;
    };
    if (!response.success) {
      throw new Error(response.error || 'Failed to connect via SSH');
    }
    return response.data;
  }

  /**
   * Disconnect from a remote server
   */
  async disconnect(connectionId: string): Promise<void> {
    const response = await invoke<{ success?: boolean; error?: string }>('ssh:disconnect', {
      connectionId,
    });
    if (!response.success) {
      throw new Error(response.error || 'Failed to disconnect');
    }
  }

  /**
   * Execute a command on the remote server
   */
  async execute(
    connectionId: string,
    command: string,
    options?: {
      cwd?: string;
      env?: Record<string, string>;
      onStdout?: (data: string) => void;
      onStderr?: (data: string) => void;
    },
  ): Promise<SSHCommandResult> {
    // Set up event listeners for streaming output if callbacks provided
    if (options?.onStdout || options?.onStderr) {
      // Listen for stdout/stderr events
      if (typeof window !== 'undefined' && (window as any).electronAPI) {
        const stdoutHandler = (data: any) => {
          if (data.connectionId === connectionId && options?.onStdout) {
            options.onStdout(data.data);
          }
        };

        const stderrHandler = (data: any) => {
          if (data.connectionId === connectionId && options?.onStderr) {
            options.onStderr(data.data);
          }
        };

        // Use ID-based listener removal for reliable cleanup with context isolation
        const stdoutListenerId = (window as any).electronAPI.on('ssh:stdout', stdoutHandler);
        const stderrListenerId = (window as any).electronAPI.on('ssh:stderr', stderrHandler);

        try {
          // Execute command
          const response = (await invoke<SSHCommandResult>('ssh:execute', {
            connectionId,
            command,
            options: {
              cwd: options?.cwd,
              env: options?.env,
            },
          })) as { success?: boolean; error?: string; data?: SSHCommandResult };

          if (!response.success) {
            throw new Error(response.error || 'Failed to execute command');
          }

          return response.data || { stdout: '', stderr: '', exitCode: 0 };
        } finally {
          // Clean up listeners using ID-based removal - always runs even if invoke() throws
          if (stdoutListenerId) (window as any).electronAPI.offById('ssh:stdout', stdoutListenerId);
          if (stderrListenerId) (window as any).electronAPI.offById('ssh:stderr', stderrListenerId);
        }
      }
    }

    // Execute without streaming
    const response = (await invoke<SSHCommandResult>('ssh:execute', {
      connectionId,
      command,
      options: {
        cwd: options?.cwd,
        env: options?.env,
      },
    })) as { success?: boolean; error?: string; data?: SSHCommandResult };

    if (!response.success) {
      throw new Error(response.error || 'Failed to execute command');
    }

    return response.data || { stdout: '', stderr: '', exitCode: 0 };
  }

  /**
   * Upload a file to the remote server
   */
  async uploadFile(connectionId: string, localPath: string, remotePath: string): Promise<void> {
    const response = await invoke<{ success?: boolean; error?: string }>('ssh:uploadFile', {
      connectionId,
      localPath,
      remotePath,
    });

    if (!response.success) {
      throw new Error(response.error || 'Failed to upload file');
    }
  }

  /**
   * Download a file from the remote server
   */
  async downloadFile(connectionId: string, remotePath: string, localPath: string): Promise<void> {
    const response = await invoke<{ success?: boolean; error?: string }>('ssh:downloadFile', {
      connectionId,
      remotePath,
      localPath,
    });

    if (!response.success) {
      throw new Error(response.error || 'Failed to download file');
    }
  }

  /**
   * List files in a remote directory
   */
  async listDirectory(connectionId: string, remotePath: string): Promise<any[]> {
    const response = (await invoke<any[]>('ssh:listDirectory', {
      connectionId,
      remotePath,
    })) as { success?: boolean; error?: string; data?: any[] };

    if (!response.success) {
      throw new Error(response.error || 'Failed to list directory');
    }

    return response.data || [];
  }

  /**
   * Detect the environment on the remote server
   */
  async detectEnvironment(connectionId: string): Promise<RemoteEnvironment> {
    const response = (await invoke<RemoteEnvironment>('ssh:detectEnvironment', {
      connectionId,
    })) as { success?: boolean; error?: string; data?: RemoteEnvironment };

    if (!response.success) {
      throw new Error(response.error || 'Failed to detect environment');
    }

    if (!response.data) {
      throw new Error('No environment data received');
    }
    return response.data;
  }

  /**
   * Check if a connection is active
   */
  async isConnected(connectionId: string): Promise<boolean> {
    const response = await invoke<{
      success?: boolean;
      error?: string;
      data?: boolean;
    }>('ssh:isConnected', {
      connectionId,
    });

    if (!response.success) {
      throw new Error(response.error || 'Failed to check connection status');
    }

    return response.data ?? false;
  }

  /**
   * Set up event listeners for SSH events
   * @returns cleanup function to remove all listeners
   */
  setupEventListeners(handlers: {
    onConnected?: (id: string) => void;
    onDisconnected?: (id: string) => void;
    onError?: (data: { id: string; error: any }) => void;
  }): () => void {
    const listenerIds: { channel: string; id: string }[] = [];

    if (typeof window !== 'undefined' && window.electronAPI) {
      const { onConnected, onDisconnected, onError } = handlers;
      if (onConnected) {
        const id = window.electronAPI.on('ssh:connected', (data) => {
          onConnected(data.id);
        });
        if (id) listenerIds.push({ channel: 'ssh:connected', id });
      }

      if (onDisconnected) {
        const id = window.electronAPI.on('ssh:disconnected', (data) => {
          onDisconnected(data.id);
        });
        if (id) listenerIds.push({ channel: 'ssh:disconnected', id });
      }

      if (onError) {
        const id = window.electronAPI.on('ssh:error', (data) => {
          onError(data);
        });
        if (id) listenerIds.push({ channel: 'ssh:error', id });
      }
    }

    // Return cleanup function
    return () => {
      if (typeof window !== 'undefined' && window.electronAPI) {
        for (const { channel, id } of listenerIds) {
          window.electronAPI.offById(channel, id);
        }
      }
    };
  }
}

// Export singleton instance
export const sshClient = new SSHClient();
