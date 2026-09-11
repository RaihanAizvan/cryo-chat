/**
 * Browser voice-note recording via the MediaRecorder API.
 *
 * Picks the most compact codec the browser supports (Opus in WebM/OGG on
 * Chromium+Firefox, AAC in MP4 on Safari). The returned handle lets the caller
 * either stop-and-send (resolving the captured blob + measured duration) or
 * cancel (stop the recorder and release the mic). A null return means the
 * browser has no recorder or the mic permission was denied.
 */

/** Preferred MIME types, most compact first. */
const MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/ogg;codecs=opus",
  "audio/mp4;codecs=mp4a.40.2",
  "audio/webm",
  "audio/ogg",
  "audio/mp4",
];

function pickMimeType(): string {
  if (typeof MediaRecorder === "undefined") return "";
  for (const c of MIME_CANDIDATES) {
    try {
      if (MediaRecorder.isTypeSupported(c)) return c;
    } catch {
      /* ignore bad type strings */
    }
  }
  return "";
}

export interface ActiveVoiceRecording {
  /** Stop recording and resolve with the bytes + measured length (seconds). */
  stop(): Promise<{ blob: Blob; duration: number }>;
  /** Discard the recording and release the microphone. */
  cancel(): void;
}

export async function startVoiceRecording(): Promise<ActiveVoiceRecording | null> {
  if (
    typeof MediaRecorder === "undefined" ||
    !navigator.mediaDevices?.getUserMedia
  ) {
    return null;
  }
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const mimeType = pickMimeType();
  let recorder: MediaRecorder;
  try {
    recorder = mimeType
      ? new MediaRecorder(stream, { mimeType })
      : new MediaRecorder(stream);
  } catch {
    stream.getTracks().forEach((t) => t.stop());
    return null;
  }
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };
  const startedAt = performance.now();
  recorder.start();

  let settled = false;
  const teardown = () => {
    stream.getTracks().forEach((t) => t.stop());
  };

  return {
    stop: () =>
      new Promise((resolve) => {
        if (settled) return;
        settled = true;
        const finish = () => {
          teardown();
          const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
          const duration = Math.max(1, Math.round((performance.now() - startedAt) / 1000));
          resolve({ blob, duration });
        };
        try {
          recorder.onstop = finish;
          recorder.stop();
        } catch {
          finish();
        }
      }),
    cancel: () => {
      if (settled) return;
      settled = true;
      try {
        recorder.stop();
      } catch {
        /* already stopped */
      }
      teardown();
    },
  };
}

/** "0:07" / "1:24" style duration label. */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds || 0));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}