/**
 * Own one native media source until its DOM consumer is retired. Removing a
 * video from the document does not cancel pending native resource selection.
 * Destroy synchronously before the owner releases any associated Blob URL.
 */
export function videoSource(video: HTMLVideoElement, initialUrl: string) {
  let url = initialUrl;
  let destroyed = false;
  const stop = () => {
    video.pause();
    video.removeAttribute('src');
    video.load();
  };
  video.setAttribute('src', url);
  return {
    update(nextUrl: string) {
      if (destroyed || nextUrl === url) return;
      stop();
      url = nextUrl;
      video.setAttribute('src', url);
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      stop();
    },
  };
}
