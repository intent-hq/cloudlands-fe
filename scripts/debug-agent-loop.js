/**
 * Agent Loop Debugging Script
 *
 * This is a browser console debugging tool for monitoring agent streaming.
 * Run this in the browser console to monitor agent streaming in real-time.
 *
 * Usage:
 *   Copy and paste this entire script into the browser console
 *
 * Configuration:
 *   agentDebugger.config({ logChunks: false })  // Disable chunk logging
 *   agentDebugger.config({ logMessages: false }) // Disable message logging
 */

(function () {
  // Only show start message if explicitly enabled
  const SHOW_START = window.DEBUG_AGENT_LOOP || false;

  if (SHOW_START) {
    console.log(
      '%c🔍 Agent Loop Debugger Started',
      'color: #4CAF50; font-weight: bold; font-size: 14px',
    );
  }

  // Configuration with sensible defaults
  const config = {
    logChunks: false, // Disabled by default - very verbose
    logMessages: false, // Disabled by default - verbose
    logPerformance: true, // Keep performance logging
    logErrors: true, // Always log errors
    showStats: true, // Show statistics
    statsInterval: 5000, // Show stats every 5 seconds
    silent: false, // Silent mode - only errors
  };

  // State tracking
  const state = {
    activeStreams: new Map(),
    messageCount: 0,
    chunkCount: 0,
    errorCount: 0,
    startTime: Date.now(),
    chunkTimings: [],
    messageTimings: [],
  };

  // Utility functions
  const formatTime = (ms) => {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  };

  const formatSize = (bytes) => {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)}KB`;
    return `${(bytes / 1024 / 1024).toFixed(2)}MB`;
  };

  // Create debug panel
  const createDebugPanel = () => {
    const panel = document.createElement('div');
    panel.id = 'agent-debug-panel';
    panel.style.cssText = `
      position: fixed;
      top: 10px;
      right: 10px;
      width: 300px;
      background: rgba(0, 0, 0, 0.9);
      color: #0f0;
      font-family: monospace;
      font-size: 12px;
      padding: 10px;
      border: 1px solid #0f0;
      border-radius: 5px;
      z-index: 10000;
      max-height: 400px;
      overflow-y: auto;
    `;

    panel.innerHTML = `
      <div style="display: flex; justify-content: space-between; margin-bottom: 10px;">
        <strong>Agent Loop Monitor</strong>
        <button id="close-debug" style="background: none; border: none; color: #f00; cursor: pointer;">✕</button>
      </div>
      <div id="debug-stats"></div>
      <div id="debug-streams" style="margin-top: 10px;"></div>
      <div id="debug-log" style="margin-top: 10px; max-height: 200px; overflow-y: auto;"></div>
    `;

    document.body.appendChild(panel);

    document.getElementById('close-debug').onclick = () => {
      panel.remove();
      window.agentDebugger?.stop();
    };

    return panel;
  };

  // Update debug panel
  const updateDebugPanel = () => {
    const statsEl = document.getElementById('debug-stats');
    const streamsEl = document.getElementById('debug-streams');

    if (!statsEl || !streamsEl) return;

    const runtime = Date.now() - state.startTime;
    const avgChunkTime =
      state.chunkTimings.length > 0
        ? state.chunkTimings.reduce((a, b) => a + b, 0) / state.chunkTimings.length
        : 0;
    const avgMessageTime =
      state.messageTimings.length > 0
        ? state.messageTimings.reduce((a, b) => a + b, 0) / state.messageTimings.length
        : 0;

    statsEl.innerHTML = `
      <div>Runtime: ${formatTime(runtime)}</div>
      <div>Messages: ${state.messageCount}</div>
      <div>Chunks: ${state.chunkCount}</div>
      <div>Errors: ${state.errorCount}</div>
      <div>Avg Chunk Time: ${formatTime(avgChunkTime)}</div>
      <div>Avg Message Time: ${formatTime(avgMessageTime)}</div>
    `;

    streamsEl.innerHTML = `
      <strong>Active Streams (${state.activeStreams.size}):</strong>
      ${Array.from(state.activeStreams.entries())
    .map(
      ([id, stream]) => `
        <div style="margin-left: 10px; color: #ff0;">
          ${id.substring(0, 8)}... - ${stream.chunks} chunks, ${formatTime(Date.now() - stream.startTime)}
        </div>
      `,
    )
    .join('')}
    `;
  };

  // Log to debug panel
  const debugLog = (message, type = 'info') => {
    // Skip logging if in silent mode (except errors)
    if (config.silent && type !== 'error') return;

    // Skip specific log types based on config
    if (type === 'chunk' && !config.logChunks) return;
    if (type === 'message' && !config.logMessages) return;

    const logEl = document.getElementById('debug-log');
    if (!logEl) return;

    const colors = {
      info: '#0f0',
      warn: '#ff0',
      error: '#f00',
      chunk: '#0ff',
      message: '#f0f',
    };

    const entry = document.createElement('div');
    entry.style.color = colors[type] || '#fff';
    entry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
    logEl.insertBefore(entry, logEl.firstChild);

    // Keep only last 50 entries
    while (logEl.children.length > 50) {
      logEl.removeChild(logEl.lastChild);
    }
  };

  // Intercept WebSocket for streaming
  const interceptWebSocket = () => {
    const originalSend = WebSocket.prototype.send;
    const originalOnMessage = Object.getOwnPropertyDescriptor(WebSocket.prototype, 'onmessage');

    WebSocket.prototype.send = function (data) {
      if (config.logMessages) {
        try {
          const parsed = JSON.parse(data);
          if (parsed.type === 'message' || parsed.content) {
            debugLog(`→ Sending: ${parsed.content?.substring(0, 50)}...`, 'message');
            state.messageCount++;
          }
        } catch (e) {
          // Not JSON, ignore
        }
      }
      return originalSend.call(this, data);
    };

    Object.defineProperty(WebSocket.prototype, 'onmessage', {
      set (handler) {
        const wrappedHandler = function (event) {
          if (config.logChunks) {
            try {
              const data = JSON.parse(event.data);
              if (data.type === 'chunk' || data.type === 'stream') {
                const streamId = data.sessionId || data.agentId || 'unknown';

                if (!state.activeStreams.has(streamId)) {
                  state.activeStreams.set(streamId, {
                    startTime: Date.now(),
                    chunks: 0,
                    size: 0,
                  });
                  debugLog(`Stream started: ${streamId}`, 'chunk');
                }

                const stream = state.activeStreams.get(streamId);
                stream.chunks++;
                stream.size += event.data.length;
                state.chunkCount++;

                const chunkTime = Date.now() - stream.startTime;
                state.chunkTimings.push(chunkTime);

                // Keep only last 100 timings
                if (state.chunkTimings.length > 100) {
                  state.chunkTimings.shift();
                }

                if (stream.chunks % 10 === 0) {
                  debugLog(
                    `Stream ${streamId}: ${stream.chunks} chunks, ${formatSize(stream.size)}`,
                    'chunk',
                  );
                }
              } else if (data.type === 'complete' || data.type === 'end') {
                const streamId = data.sessionId || data.agentId || 'unknown';
                const stream = state.activeStreams.get(streamId);

                if (stream) {
                  const duration = Date.now() - stream.startTime;
                  state.messageTimings.push(duration);

                  debugLog(
                    `Stream complete: ${streamId} - ${stream.chunks} chunks in ${formatTime(duration)}`,
                    'message',
                  );

                  state.activeStreams.delete(streamId);
                }
              }
            } catch (e) {
              // Not JSON or parsing error
            }
          }

          if (handler) {
            handler.call(this, event);
          }
        };

        if (originalOnMessage && originalOnMessage.set) {
          originalOnMessage.set.call(this, wrappedHandler);
        }
      },
      get: originalOnMessage ? originalOnMessage.get : undefined,
    });
  };

  // Intercept fetch for API calls
  const interceptFetch = () => {
    const originalFetch = window.fetch;

    window.fetch = async function (...args) {
      const [url, options] = args;
      const isAgentCall = url.includes('/agent') || url.includes('/message');

      if (isAgentCall && config.logMessages) {
        const startTime = Date.now();

        try {
          const response = await originalFetch.apply(this, args);
          const duration = Date.now() - startTime;

          if (response.ok) {
            debugLog(`API: ${url.split('/').pop()} - ${formatTime(duration)}`, 'info');
          } else {
            debugLog(`API Error: ${url.split('/').pop()} - ${response.status}`, 'error');
            state.errorCount++;
          }

          return response;
        } catch (error) {
          const duration = Date.now() - startTime;
          debugLog(`API Failed: ${url.split('/').pop()} - ${formatTime(duration)}`, 'error');
          state.errorCount++;
          throw error;
        }
      }

      return originalFetch.apply(this, args);
    };
  };

  // Monitor DOM for message updates
  const monitorDOM = () => {
    const observer = new MutationObserver((mutations) => {
      if (!config.logMessages && !config.logChunks) return; // Skip if both disabled

      mutations.forEach((mutation) => {
        if (mutation.type === 'childList') {
          mutation.addedNodes.forEach((node) => {
            if (node.nodeType === 1) {
              // Element node
              if (
                node.classList?.contains('message-container') ||
                node.classList?.contains('assistant-message')
              ) {
                debugLog('New message rendered in DOM', 'message');
              }

              if (node.classList?.contains('streaming')) {
                debugLog('Streaming indicator active', 'chunk');
              }
            }
          });
        }
      });
    });

    // Start observing the chat container
    const chatContainer = document.querySelector(
      '.chat-container, .message-list, [data-testid="chat"]',
    );
    if (chatContainer) {
      observer.observe(chatContainer, {
        childList: true,
        subtree: true,
      });
      if (config.logMessages || config.logChunks) {
        debugLog('DOM monitoring started', 'info');
      }
    } else if (config.logMessages || config.logChunks) {
      debugLog('Chat container not found', 'warn');
    }

    return observer;
  };

  // Performance monitoring
  const monitorPerformance = () => {
    if (!config.logPerformance) return;

    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.name.includes('agent') || entry.name.includes('message')) {
          debugLog(`Performance: ${entry.name} - ${formatTime(entry.duration)}`, 'info');
        }
      }
    });

    observer.observe({ entryTypes: ['measure', 'navigation'] });

    return observer;
  };

  // Start debugging
  const start = () => {
    const panel = createDebugPanel();
    interceptWebSocket();
    interceptFetch();
    const domObserver = monitorDOM();
    const perfObserver = monitorPerformance();

    // Update stats periodically
    const statsInterval = setInterval(updateDebugPanel, 1000);

    // Show initial stats
    updateDebugPanel();
    debugLog('Debugger initialized', 'info');

    // Return control object
    return {
      stop: () => {
        clearInterval(statsInterval);
        domObserver?.disconnect();
        perfObserver?.disconnect();
        panel?.remove();
        console.log('%c🛑 Agent Loop Debugger Stopped', 'color: #f44336; font-weight: bold;');
      },

      config: (updates) => {
        Object.assign(config, updates);
        debugLog(`Config updated: ${JSON.stringify(updates)}`, 'info');
      },

      stats: () => {
        console.table({
          Runtime: formatTime(Date.now() - state.startTime),
          Messages: state.messageCount,
          Chunks: state.chunkCount,
          Errors: state.errorCount,
          'Active Streams': state.activeStreams.size,
          'Avg Chunk Time': formatTime(
            state.chunkTimings.reduce((a, b) => a + b, 0) / state.chunkTimings.length || 0,
          ),
          'Avg Message Time': formatTime(
            state.messageTimings.reduce((a, b) => a + b, 0) / state.messageTimings.length || 0,
          ),
        });
      },

      clearLog: () => {
        const logEl = document.getElementById('debug-log');
        if (logEl) logEl.innerHTML = '';
        debugLog('Log cleared', 'info');
      },
    };
  };

  // Expose debugger globally
  window.agentDebugger = start();

  // Only show commands if not in silent mode
  if (!config.silent && SHOW_START) {
    console.log('%cAvailable commands:', 'color: #2196F3; font-weight: bold;');
    console.log('  agentDebugger.stop()     - Stop the debugger');
    console.log('  agentDebugger.stats()    - Show current statistics');
    console.log('  agentDebugger.clearLog() - Clear the debug log');
    console.log('  agentDebugger.config({...}) - Update configuration');
    console.log('  agentDebugger.config({ silent: true }) - Enable silent mode');
  }
})();
