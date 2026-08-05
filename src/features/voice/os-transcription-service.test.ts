/**
 * Tests for the OS transcription engine seam: the exact IPC request shape on
 * `voice:transcribe-local`, typed error mapping from the safe-handler
 * response, and the availability probe folding failures to `false`.
 * The WAV conversion is stubbed (no WebAudio in jsdom).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { IPC_CHANNELS } from "$shared/ipc-registry";

const invokeMock = vi.fn();
vi.mock("$shared/generated/ipc-client", () => ({
  invoke: (...args: unknown[]) => (invokeMock as (...a: unknown[]) => unknown)(...args),
}));

/** [1,2,3] encodes to "AQID" in standard padded base64. */
const WAV_BYTES = new Uint8Array([1, 2, 3]).buffer;
vi.mock("./utils/wav-encoder", async (importOriginal) => {
  const original = await importOriginal<typeof import("./utils/wav-encoder")>();
  return { ...original, blobToWav: vi.fn(() => Promise.resolve(WAV_BYTES)) };
});

import {
  isOsTranscriptionAvailable,
  OsTranscriptionError,
  requestOsSpeechAuthorization,
  transcribeWithOs,
} from "./os-transcription-service";
import { blobToWav } from "./utils/wav-encoder";

const AUDIO = new Blob([new Uint8Array([9, 9, 9])], { type: "audio/webm" });

afterEach(() => {
  vi.clearAllMocks();
});

describe("transcribeWithOs", () => {
  it("sends the WAV as base64 with contextual strings on voice:transcribe-local", async () => {
    invokeMock.mockResolvedValue({ success: true, text: "hello world", durationMs: 1200 });

    const result = await transcribeWithOs(AUDIO, ["intentd", "Cloudlands"]);

    expect(blobToWav).toHaveBeenCalledWith(AUDIO);
    expect(invokeMock).toHaveBeenCalledWith(IPC_CHANNELS.VOICE.TRANSCRIBE_LOCAL, {
      audioBase64: "AQID",
      mimeType: "audio/wav",
      contextualStrings: ["intentd", "Cloudlands"],
    });
    expect(result).toEqual({ text: "hello world", durationMs: 1200 });
  });

  it("omits contextualStrings when there are no keyterms", async () => {
    invokeMock.mockResolvedValue({ success: true, text: "", durationMs: null });

    await transcribeWithOs(AUDIO);

    expect(invokeMock).toHaveBeenCalledWith(IPC_CHANNELS.VOICE.TRANSCRIBE_LOCAL, {
      audioBase64: "AQID",
      mimeType: "audio/wav",
    });
  });

  it("forwards the trimmed locale on voice:transcribe-local", async () => {
    invokeMock.mockResolvedValue({ success: true, text: "hallo", durationMs: 500 });

    await transcribeWithOs(AUDIO, undefined, " de ");

    expect(invokeMock).toHaveBeenCalledWith(IPC_CHANNELS.VOICE.TRANSCRIBE_LOCAL, {
      audioBase64: "AQID",
      mimeType: "audio/wav",
      locale: "de",
    });
  });

  it("omits the locale when blank or absent (system locale)", async () => {
    invokeMock.mockResolvedValue({ success: true, text: "", durationMs: null });

    await transcribeWithOs(AUDIO, undefined, "   ");

    expect(invokeMock).toHaveBeenCalledWith(IPC_CHANNELS.VOICE.TRANSCRIBE_LOCAL, {
      audioBase64: "AQID",
      mimeType: "audio/wav",
    });
  });

  it("throws a typed OsTranscriptionError with the main process error code", async () => {
    invokeMock.mockResolvedValue({
      success: false,
      error: { code: "authorization-denied", message: "status: 1" },
    });

    await expect(transcribeWithOs(AUDIO)).rejects.toMatchObject({
      name: "OsTranscriptionError",
      code: "authorization-denied",
      message: "status: 1",
    });
  });

  it("folds a shapeless failure to recognition-failed", async () => {
    invokeMock.mockResolvedValue({ success: false });

    await expect(transcribeWithOs(AUDIO)).rejects.toMatchObject({
      code: "recognition-failed",
    });
  });

  it("maps a WAV decode failure to audio-unreadable without touching IPC", async () => {
    vi.mocked(blobToWav).mockRejectedValueOnce(new Error("EncodingError: bad container"));

    await expect(transcribeWithOs(AUDIO)).rejects.toMatchObject({
      code: "audio-unreadable",
    });
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("exposes the code on the error class for callers", () => {
    const error = new OsTranscriptionError("helper-missing", "not found");
    expect(error.code).toBe("helper-missing");
    expect(error).toBeInstanceOf(Error);
  });
});

describe("requestOsSpeechAuthorization", () => {
  it("invokes voice:request-local-authorization with an empty payload and returns the status", async () => {
    invokeMock.mockResolvedValue({ success: true, status: "authorized" });

    await expect(requestOsSpeechAuthorization()).resolves.toBe("authorized");
    expect(invokeMock).toHaveBeenCalledWith(IPC_CHANNELS.VOICE.REQUEST_LOCAL_AUTHORIZATION, {});
  });

  it("passes through a denied status without throwing", async () => {
    invokeMock.mockResolvedValue({ success: true, status: "denied" });
    await expect(requestOsSpeechAuthorization()).resolves.toBe("denied");
  });

  it("throws a typed OsTranscriptionError with the main process error code", async () => {
    invokeMock.mockResolvedValue({
      success: false,
      error: { code: "helper-missing", message: "speech helper not found" },
    });

    await expect(requestOsSpeechAuthorization()).rejects.toMatchObject({
      name: "OsTranscriptionError",
      code: "helper-missing",
      message: "speech helper not found",
    });
  });

  it("folds a shapeless failure to authorization-failed", async () => {
    invokeMock.mockResolvedValue({ success: true });

    await expect(requestOsSpeechAuthorization()).rejects.toMatchObject({
      code: "authorization-failed",
    });
  });
});

describe("isOsTranscriptionAvailable", () => {
  it("is true only for a successful available response", async () => {
    invokeMock.mockResolvedValue({ success: true, available: true });
    await expect(isOsTranscriptionAvailable()).resolves.toBe(true);

    invokeMock.mockResolvedValue({ success: true, available: false });
    await expect(isOsTranscriptionAvailable()).resolves.toBe(false);

    invokeMock.mockResolvedValue({ success: false });
    await expect(isOsTranscriptionAvailable()).resolves.toBe(false);
  });

  it("folds a rejected probe (no bridge) to false", async () => {
    invokeMock.mockRejectedValue(new Error("no bridge"));
    await expect(isOsTranscriptionAvailable()).resolves.toBe(false);
  });
});
