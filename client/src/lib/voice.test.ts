import { describe, expect, it } from "vitest";
import { encodeWavBytes, formatDuration } from "./voice";

describe("encodeWavBytes", () => {
  it("produces a 44-byte header plus 16-bit PCM payload", () => {
    const pcm = new Int16Array([0, 100, -100, 32767, -32768]);
    const buf = encodeWavBytes({ sampleRate: 16000, channels: 1, pcm });
    const view = new DataView(buf);
    const utf8 = (off: number, len: number) =>
      String.fromCharCode(...new Uint8Array(buf, off, len));

    expect(buf.byteLength).toBe(44 + pcm.length * 2);
    // RIFF/WAVE fmt chunk markers
    expect(utf8(0, 4)).toBe("RIFF");
    expect(utf8(8, 4)).toBe("WAVE");
    expect(utf8(12, 4)).toBe("fmt ");
    expect(utf8(36, 4)).toBe("data");
    // PCM format tag, mono channel, sample rate & byte rate
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(16000);
    expect(view.getUint32(28, true)).toBe(16000 * 1 * 2);
    // data size field matches payload
    expect(view.getUint32(40, true)).toBe(pcm.length * 2);
  });

  it("echoes multi-channel config into the header", () => {
    const pcm = new Int16Array(4);
    const buf = encodeWavBytes({ sampleRate: 44100, channels: 2, pcm });
    const view = new DataView(buf);
    expect(view.getUint16(22, true)).toBe(2);
    expect(view.getUint32(28, true)).toBe(44100 * 2 * 2);
    expect(view.getUint16(32, true)).toBe(4); // block align
    expect(view.getUint16(34, true)).toBe(16); // bits per sample
  });
});

describe("formatDuration", () => {
  it("formats seconds as MM:SS", () => {
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(7)).toBe("0:07");
    expect(formatDuration(60)).toBe("1:00");
    expect(formatDuration(84.7)).toBe("1:24");
    expect(formatDuration(125)).toBe("2:05");
  });

  it("clamps negative/NaN input", () => {
    expect(formatDuration(-5)).toBe("0:00");
    expect(formatDuration(Number.NaN)).toBe("0:00");
  });
});