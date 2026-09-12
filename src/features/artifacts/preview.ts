import type { ArtifactJson } from '$shared/types/visual-artifact';
import { isBoundedJson } from './model';

export const MAX_PREVIEW_STATE_BYTES = 32768;

export { isAllowedArtifactImageSource } from '$shared/types/visual-artifact';

export function parsePreviewStateMessage(data: unknown): ArtifactJson | undefined {
  if (
    !data ||
    typeof data !== 'object' ||
    !('type' in data) ||
    data.type !== 'intent-artifact:state' ||
    !('state' in data)
  )
    return undefined;
  return isBoundedJson(data.state, MAX_PREVIEW_STATE_BYTES)
    ? (data.state as ArtifactJson)
    : undefined;
}

/** Used only as srcdoc in an opaque-origin sandbox with allow-scripts (never allow-same-origin). */
export function buildPreviewDocument(html: string, state: ArtifactJson = null): string {
  if (html.length > 200000 || !isBoundedJson(state, MAX_PREVIEW_STATE_BYTES))
    throw new Error('Preview exceeds limits');
  const initial = JSON.stringify(state)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
  const bridge = `<script>(() => {
    let state = ${initial};
    const clone = value => JSON.parse(JSON.stringify(value));
    window.intentArtifact = Object.freeze({
      getState: () => clone(state),
      setState: value => {
        const serialized = JSON.stringify(value);
        if (typeof serialized !== 'string' || new TextEncoder().encode(serialized).length > ${MAX_PREVIEW_STATE_BYTES}) throw new Error('State exceeds limit');
        state = JSON.parse(serialized);
        parent.postMessage({ type: 'intent-artifact:state', state }, '*');
      }
    });
    addEventListener('message', event => {
      if (event.source !== parent) return;
      if (event.data?.type === 'intent-artifact:capture') parent.postMessage({type: 'intent-artifact:state', state}, '*');
      if (event.data?.type === 'intent-artifact:restore') {
        window.intentArtifact.setState(event.data.state);
        dispatchEvent(new CustomEvent('intent-artifact:restored', {detail: clone(state)}));
      }
    });
  })();</script>`;
  return (
    "<!doctype html><html><head><meta charset=\"utf-8\"><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'\"><meta name=\"referrer\" content=\"no-referrer\">" +
    bridge +
    '</head><body>' +
    html +
    '</body></html>'
  );
}
