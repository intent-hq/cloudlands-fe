/** External microphone boundary only. Production VoiceRecorder/WAV conversion stay real. */
export function installSyntheticFeedbackMedia() {
  if (!navigator.mediaDevices) return; // Electron's transient about:blank has no media surface.
  const audit = { acquisitions: 0, starts: 0, stops: 0, chunks: [] as number[] };
  const originalDecode = AudioContext.prototype.decodeAudioData;
  AudioContext.prototype.decodeAudioData = function (buffer, ...args) {
    console.debug('feedback-audio-decode', buffer.byteLength);
    const result = originalDecode.call(this, buffer, ...args);
    void result.then(
      (audio) => console.debug('feedback-audio-decoded', audio.length, audio.sampleRate),
      (error) => console.debug('feedback-audio-decode-error', String(error)),
    );
    return result;
  };
  let current: SyntheticRecorder | undefined;
  class SyntheticRecorder {
    static isTypeSupported() {
      return true;
    }
    mimeType = 'audio/wav';
    state = 'inactive';
    ondataavailable: ((event: { data: Blob }) => void) | null = null;
    onstop: (() => void) | null = null;
    onerror: ((event: unknown) => void) | null = null;
    part = 0;
    bytes = new Uint8Array(44 + 6400);
    constructor() {
      const view = new DataView(this.bytes.buffer);
      const tag = (offset: number, text: string) =>
        [...text].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)));
      tag(0, 'RIFF');
      view.setUint32(4, this.bytes.length - 8, true);
      tag(8, 'WAVE');
      tag(12, 'fmt ');
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true);
      view.setUint16(22, 1, true);
      view.setUint32(24, 16000, true);
      view.setUint32(28, 32000, true);
      view.setUint16(32, 2, true);
      view.setUint16(34, 16, true);
      tag(36, 'data');
      view.setUint32(40, 6400, true);
      // Distinct PCM levels let the transcription boundary prove both halves survived.
      for (let i = 0; i < 3200; i++) view.setInt16(44 + i * 2, i < 1600 ? 6553 : 19660, true);
    }
    start() {
      current = this;
      this.state = 'recording';
      audit.starts++;
    }
    emitPart() {
      if (this.state !== 'recording' || this.part >= 2) return;
      const bytes = this.part === 0 ? this.bytes.slice(0, 3244) : this.bytes.slice(3244);
      audit.chunks.push(bytes.length);
      this.part++;
      this.ondataavailable?.({ data: new Blob([bytes], { type: 'audio/wav' }) });
    }
    stop() {
      if (this.state !== 'recording') return;
      while (this.part < 2) this.emitPart();
      this.state = 'inactive';
      audit.stops++;
      console.debug('feedback-media-stopped', JSON.stringify(audit));
      this.onstop?.();
    }
  }
  window.MediaRecorder = SyntheticRecorder as unknown as typeof MediaRecorder;
  navigator.mediaDevices.getUserMedia = async () => {
    audit.acquisitions++;
    return new MediaStream();
  };
  Object.assign(window, {
    feedbackMedia: {
      emitPart: () => current?.emitPart(),
      evidence: () => ({ ...audit, chunks: [...audit.chunks], part: current?.part }),
    },
  });
}
