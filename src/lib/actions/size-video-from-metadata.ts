/**
 * A poster supplies the native video's intrinsic size even after metadata loads.
 * Size the lightbox from the decoded video instead, fitting its existing viewport
 * bounds without upscaling. This owns layout only, never playback or readiness.
 */
export function sizeVideoFromMetadata(video: HTMLVideoElement): () => void {
  const originalWidth = video.style.width;
  const originalHeight = video.style.height;
  const restore = () => {
    video.style.width = originalWidth;
    video.style.height = originalHeight;
  };
  const update = () => {
    const { videoWidth: width, videoHeight: height } = video;
    if (!width || !height) {
      restore();
      return;
    }
    video.style.width = `min(${width}px, 90vw, ${(85 * width) / height}vh)`;
    video.style.height = `min(${height}px, ${(90 * height) / width}vw, 85vh)`;
  };
  video.addEventListener('loadedmetadata', update);
  video.addEventListener('resize', update);
  video.addEventListener('emptied', restore);
  update();
  return () => {
    video.removeEventListener('loadedmetadata', update);
    video.removeEventListener('resize', update);
    video.removeEventListener('emptied', restore);
    restore();
  };
}
