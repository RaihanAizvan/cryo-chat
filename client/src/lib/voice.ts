/**
 * Browser voice-note recording via the MediaRecorder API.
 *
 * Recording uses the most compact codec the browser supports (Opus in
 * WebM/OGG on Chromium+Firefox, AAC in MP4 on Safari). Because MediaRecorder
 * files don't carry a real duration in their container (browsers report
 * `audio.duration === Infinity` until played through, and WebM/Opus won't
 * decode on iOS Safari 15.4–17.3), every note is re-encoded on stop into a
 * mono 16-bit PCM WAV. WAV plays on literally every device and its length is
 * exact — it's the audio sample count / sample rate, not a wall-clock guess.
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

/** PCM sample rate for the produced WAV (telephony-grade, tiny files). */
const WAV_SAMPLE_RATE = 16000;

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
        const finish = async () => {
          teardown();
          const raw = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
          // Re-encode to WAV so every device can play it. Falls back to the
          // raw bytes + a wall-clock guess when decoding is unavailable.
          const wav = await reencodeToWav(raw);
          if (wav) {
            resolve({ blob: wav.blob, duration: Math.max(1, Math.round(wav.duration)) });
          } else {
            const duration = Math.max(1, Math.round((performance.now() - startedAt) / 1000));
            resolve({ blob: raw, duration });
          }
        };
        try {
          recorder.onstop = () => void finish();
          recorder.stop();
        } catch {
          void finish();
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

/**
 * Decode any recorded blob and re-encode it as a mono 16-bit PCM WAV.
 * Returns null when Web Audio decoding fails (null → caller keeps the raw
 * bytes). Duration is the decoded sample count / sample rate — exact.
 */
export async function reencodeToWav(
  input: Blob,
): Promise<{ blob: Blob; duration: number } | null> {
  const AC =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof window.AudioContext }).webkitAudioContext;
  if (!AC) return null;
  let ctx: AudioContext | null = null;
  try {
    ctx = new AC();
    if (ctx.state === "suspended") void ctx.resume();
    const buffer = await ctx.decodeAudioData(await input.arrayBuffer());
    const rate = WAV_SAMPLE_RATE;
    const frames = Math.max(1, Math.ceil(buffer.duration * rate));

    // Render mono at the target rate; the offline graph mixes down and
    // resamples automatically.
    const offline = new OfflineAudioContext(1, frames, rate);
    const src = offline.createBufferSource();
    src.buffer = buffer;
    src.connect(offline.destination);
    src.start(0);
    const rendered = await offline.startRendering();

    const data = rendered.getChannelData(0);
    const pcm = new Int16Array(data.length);
    for (let i = 0; i < data.length; i++) {
      const s = Math.max(-1, Math.min(1, data[i]));
      pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return {
      blob: new Blob([encodeWavBytes({ sampleRate: rate, channels: 1, pcm })], {
        type: "audio/wav",
      }),
      duration: data.length / rate,
    };
  } catch {
    return null;
  } finally {
    if (ctx) void ctx.close();
  }
}

/** Byte-packed RIFF/WAVE header + mono 16-bit PCM payload. */
function encodeWavBytes({
  sampleRate,
  channels,
  pcm,
}: {
  sampleRate: number;
  channels: number;
  pcm: Int16Array;
}): ArrayBuffer {
  const byteRate = sampleRate * channels * 2;
  const dataSize = pcm.length * 2;
  const buf = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buf);
  const str = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  str(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  str(8, "WAVE");
  str(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  str(36, "data");
  view.setUint32(40, dataSize, true);
  new Int16Array(buf, 44).set(pcm);
  return buf;
}

/** "0:07" / "1:24" style duration label. */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds || 0));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}