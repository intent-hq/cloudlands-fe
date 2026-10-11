import { PNG } from "pngjs";

// Encode a real local image; browser decoders and FileReader consume these bytes.
export function imageFile(name = "browser-image.png") {
  const png = new PNG({ width: 16, height: 10 });
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i] = (i / 4) % 256;
    png.data[i + 1] = 140;
    png.data[i + 2] = 220;
    png.data[i + 3] = 255;
  }
  return { name, mimeType: "image/png", buffer: PNG.sync.write(png) };
}

export async function putImageOnClipboard(page, context) {
  await context.grantPermissions(["clipboard-read", "clipboard-write"], {
    origin: new URL(page.url()).origin,
  });
  return page.evaluate(
    async (bytes) => {
      await navigator.clipboard.write([
        new ClipboardItem({
          "image/png": new Blob([new Uint8Array(bytes)], { type: "image/png" }),
        }),
      ]);
      // Chromium may re-encode PNG on the OS clipboard. Compare the bytes actually pasted.
      const [item] = await navigator.clipboard.read();
      const blob = await item.getType("image/png");
      return btoa(String.fromCharCode(...new Uint8Array(await blob.arrayBuffer())));
    },
    [...imageFile().buffer],
  );
}

export async function downloadBytes(download) {
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

export async function recordVideoFile(page) {
  const bytes = await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 48;
    const context = canvas.getContext("2d");
    const stream = canvas.captureStream(10);
    const recorder = new MediaRecorder(stream, { mimeType: "video/mp4;codecs=vp9" });
    const chunks = [];
    recorder.ondataavailable = (event) => chunks.push(event.data);
    const stopped = new Promise((resolve, reject) => {
      recorder.onstop = resolve;
      recorder.onerror = reject;
    });
    recorder.start();
    try {
      // Real frames become a local MP4. No media element metadata is assigned or mocked.
      for (const color of ["red", "green", "blue", "orange"]) {
        context.fillStyle = color;
        context.fillRect(0, 0, canvas.width, canvas.height);
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      recorder.stop();
      await stopped;
      return [...new Uint8Array(await new Blob(chunks).arrayBuffer())];
    } finally {
      stream.getTracks().forEach((track) => track.stop());
    }
  });
  return { name: "native-recording.mp4", mimeType: "video/mp4", buffer: Buffer.from(bytes) };
}
