/**
 * WAV conversion for the OS dictation engine.
 *
 * MediaRecorder captures dictation as webm/opus, which macOS AVFoundation
 * (the speech helper's reader) cannot open. Chromium's WebAudio decoder CAN
 * read webm/opus, so the renderer decodes the recording, downmixes to mono,
 * resamples to 16 kHz via OfflineAudioContext, and re-encodes it as 16-bit
 * PCM WAV before shipping it over IPC.
 *
 * Dependency-light utility per src/lib AGENTS.md — no stores or services.
 */

/** Speech-recognition friendly rate; keeps the base64 IPC payload small. */
export const WAV_SAMPLE_RATE = 16_000;

/** Encode a mono Float32 PCM buffer as a 16-bit PCM WAV file. */
export function encodeWavPcm16(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const bytesPerSample = 2;
  const dataLength = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataLength);
  const view = new DataView(buffer);
  const writeAscii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  };
  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + dataLength, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true); // byte rate
  view.setUint16(32, bytesPerSample, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeAscii(36, 'data');
  view.setUint32(40, dataLength, true);
  let offset = 44;
  for (let i = 0; i < samples.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
    offset += bytesPerSample;
  }
  return buffer;
}

/** Downmix an AudioBuffer's channels into one mono Float32 track. */
export function downmixToMono(audio: AudioBuffer): Float32Array {
  const mono = new Float32Array(audio.length);
  for (let channel = 0; channel < audio.numberOfChannels; channel += 1) {
    const data = audio.getChannelData(channel);
    for (let i = 0; i < data.length; i += 1) mono[i] += data[i] / audio.numberOfChannels;
  }
  return mono;
}

/**
 * Decode a recorded audio blob and re-encode it as 16 kHz mono 16-bit WAV.
 * Throws when the container cannot be decoded (surfaced by the caller as a
 * transcription failure).
 */
export async function blobToWav(blob: Blob): Promise<ArrayBuffer> {
  const decodeContext = new AudioContext();
  try {
    const decoded = await decodeContext.decodeAudioData(await blob.arrayBuffer());
    const targetLength = Math.max(
      1,
      Math.ceil((decoded.length * WAV_SAMPLE_RATE) / decoded.sampleRate),
    );
    const offline = new OfflineAudioContext(1, targetLength, WAV_SAMPLE_RATE);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start();
    const resampled = await offline.startRendering();
    return encodeWavPcm16(downmixToMono(resampled), WAV_SAMPLE_RATE);
  } finally {
    await decodeContext.close().catch(() => undefined);
  }
}

/** Base64-encode an ArrayBuffer in chunks (avoids call-stack limits). */
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}
