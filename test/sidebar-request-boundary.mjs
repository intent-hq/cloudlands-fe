/** Wait for the controlled request without hiding an earlier preparation failure. */
export async function waitForSidebarRequest(requested, preparation, timeoutMs) {
  let timer;
  try {
    await Promise.race([
      requested,
      preparation.then((error) => {
        throw error ?? new Error('Sidebar preparation completed without the controlled request');
      }),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('Sidebar fixture request deadline exceeded')),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
