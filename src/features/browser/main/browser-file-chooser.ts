/**
 * Website file uploads in browser tabs under INTENT_IN_APP_PICKER=1.
 *
 * A page's `<input type=file>` opens Chromium's native chooser, which does
 * nothing on Intent OS. While the flag is on, each browser tab's CDP session
 * intercepts file choosers (`Page.setInterceptFileChooserDialog`); on
 * `Page.fileChooserOpened` the in-app picker opens in the app renderer that
 * shows the tab, and the chosen files go into the input with
 * `DOM.setFileInputFiles`. A cancel leaves the input's files as they were and
 * fires its `cancel` event, as Chromium's own chooser does.
 *
 * Not covered: choosers inside cross-origin iframes that run in their own
 * process (a separate CDP target that this tab session does not see).
 */

/** The CDP calls this module needs on one tab's session. */
export interface FileChooserCdp {
  send(method: string, params?: Record<string, unknown>): Promise<unknown>;
}

/** `Page.fileChooserOpened` params (CDP 1.3). */
export interface FileChooserOpenedParams {
  frameId?: string;
  mode: 'selectSingle' | 'selectMultiple';
  backendNodeId?: number;
}

/** Ask the user for files; resolves the chosen paths or `null` on cancel. */
export type PickFiles = (options: {
  multiple: boolean;
  accept?: string;
}) => Promise<string[] | null>;

/** Turn interception on for a freshly attached tab session. */
export async function enableFileChooserInterception(cdp: FileChooserCdp): Promise<void> {
  await cdp.send('Page.enable');
  await cdp.send('Page.setInterceptFileChooserDialog', { enabled: true });
}

async function withInputObject<T>(
  cdp: FileChooserCdp,
  backendNodeId: number,
  run: (objectId: string) => Promise<T>,
): Promise<T | undefined> {
  const resolved = (await cdp.send('DOM.resolveNode', { backendNodeId })) as {
    object?: { objectId?: string };
  };
  const objectId = resolved?.object?.objectId;
  if (!objectId) return undefined;
  try {
    return await run(objectId);
  } finally {
    await cdp.send('Runtime.releaseObject', { objectId }).catch(() => undefined);
  }
}

async function readAccept(cdp: FileChooserCdp, backendNodeId: number): Promise<string | undefined> {
  try {
    return await withInputObject(cdp, backendNodeId, async (objectId) => {
      const result = (await cdp.send('Runtime.callFunctionOn', {
        objectId,
        functionDeclaration:
          'function () { return typeof this.accept === "string" ? this.accept : ""; }',
        returnByValue: true,
      })) as { result?: { value?: unknown } };
      const value = result?.result?.value;
      return typeof value === 'string' && value ? value : undefined;
    });
  } catch {
    // Without the accept list the picker shows every file, like a missing accept.
    return undefined;
  }
}

async function fireCancel(cdp: FileChooserCdp, backendNodeId: number): Promise<void> {
  await withInputObject(cdp, backendNodeId, async (objectId) => {
    await cdp.send('Runtime.callFunctionOn', {
      objectId,
      functionDeclaration:
        'function () { this.dispatchEvent(new Event("cancel", { bubbles: true })); }',
    });
  }).catch(() => undefined);
}

/**
 * Answer one intercepted chooser: show the in-app picker, then fill the input
 * (or fire `cancel`). Returns the paths given to the page, or `null` on cancel.
 */
export async function answerFileChooser(
  cdp: FileChooserCdp,
  params: FileChooserOpenedParams,
  pickFiles: PickFiles,
): Promise<string[] | null> {
  const { backendNodeId } = params;
  if (typeof backendNodeId !== 'number') return null;
  const multiple = params.mode === 'selectMultiple';
  const accept = await readAccept(cdp, backendNodeId);
  const picked = await pickFiles({ multiple, accept });
  if (!picked || picked.length === 0) {
    await fireCancel(cdp, backendNodeId);
    return null;
  }
  const files = multiple ? picked : picked.slice(0, 1);
  await cdp.send('DOM.setFileInputFiles', { files, backendNodeId });
  return files;
}
