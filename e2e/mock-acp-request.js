/** Preserve request identity when a fixture handler fails, so ACP can finish the turn. */
export async function respondToMockRequest(line, handleMessage, reportError) {
  let message;
  try {
    message = JSON.parse(line);
  } catch (error) {
    return JSON.stringify({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32700, message: `Parse error: ${String(error).slice(0, 2048)}` },
    });
  }
  try {
    return await handleMessage(message);
  } catch (error) {
    const detail = String(error).slice(0, 2048);
    reportError(`[mock-agent] ${message?.method ?? 'unknown'} failed: ${detail}\n`);
    if (message?.id === undefined) return null;
    return JSON.stringify({
      jsonrpc: '2.0',
      id: message.id,
      error: { code: -32603, message: detail },
    });
  }
}
