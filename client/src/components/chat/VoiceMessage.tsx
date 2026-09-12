import { useEffect, useMemo, useRef, useState } from "react";
import type { MessageAttachment } from "@cryo/shared";
import { mediaUrl } from "../../lib/api";
import { formatDuration } from "../../lib/voice";
import { IconPauseFilled, IconPlayFilled } from "../ui/Icon";

const BAR_COUNT = 22;

/**
 * Only one voice note plays at a time (WhatsApp-style): when a note starts,
 * any other currently-playing note is paused.
 */
let activeElement: HTMLAudioElement | null = null;

interface Props {
  attachment: MessageAttachment;
  /** Viewer's session id — used as the fetch identity for the media bytes. */
  sessionId: string;
  /** Colors adapt to whether this bubble is ours (on accent) or theirs. */
  mine: boolean;
}

/**
 * Voice-note bubble content: a play/pause button, a waveform-ish bar equalizer
 * driven by playback progress, and a duration label. Seek by tapping the bars.
 */
export function VoiceMessage({ attachment, sessionId, mine }: Props) {
  const url = useMemo(
    () => mediaUrl(attachment.mediaId, sessionId),
    [attachment.mediaId, sessionId],
  );

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [length, setLength] = useState<number>(attachment.duration ?? 0);
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    const audio = new Audio(url);
    audio.preload = "metadata";
    const onMeta = () => {
      if (Number.isFinite(audio.duration) && audio.duration > 0) {
        setLength(audio.duration);
      }
      setSettled(true);
    };
    const onTime = () => setElapsed(audio.currentTime);
    const onEnded = () => {
      setPlaying(false);
      setElapsed(0);
      if (activeElement === audio) activeElement = null;
    };
    const onPlay = () => {
      if (activeElement && activeElement !== audio && !activeElement.paused) {
        activeElement.pause();
      }
      activeElement = audio;
      setPlaying(true);
    };
    const onPause = () => setPlaying(false);
    audio.addEventListener("loadedmetadata", onMeta);
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audioRef.current = audio;
    return () => {
      audio.pause();
      audio.src = "";
      if (activeElement === audio) activeElement = null;
      audio.removeEventListener("loadedmetadata", onMeta);
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
    };
  }, [url]);

  const toggle = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) void audio.play().catch(() => {});
    else audio.pause();
  };

  const seekTo = (fraction: number) => {
    const audio = audioRef.current;
    if (!audio || !settled || !Number.isFinite(audio.duration)) return;
    audio.currentTime = Math.min(audio.duration - 0.05, Math.max(0, audio.duration * fraction));
    setElapsed(audio.currentTime);
  };

  const fraction = length > 0 ? Math.min(1, elapsed / length) : 0;
  const litBars = Math.round(fraction * BAR_COUNT);

  const barClass = (i: number) => {
    const active = i < litBars;
    if (mine) return active ? "bg-white" : "bg-white/35";
    return active ? "bg-accent" : "bg-ink-faint/70";
  };

  return (
    <div className={`flex items-center gap-3 ${mine ? "text-white" : "text-ink"}`}>
      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? "Pause" : "Play"}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-all active:scale-95"
        style={{ backgroundColor: mine ? "rgba(255,255,255,0.18)" : "rgba(0,0,0,0.06)" }}
      >
        {playing ? (
          <IconPauseFilled width={16} height={16} />
        ) : (
          <IconPlayFilled width={15} height={15} className="ml-0.5" />
        )}
      </button>

      <div
        className="flex h-8 min-w-0 flex-1 cursor-pointer items-center gap-[2px]"
        role="slider"
        aria-label="Seek"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(fraction * 100)}
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const frac = rect.width > 0 ? (e.clientX - rect.left) / rect.width : 0;
          seekTo(frac);
        }}
      >
        {Array.from({ length: BAR_COUNT }, (_, i) => {
          const peak = 0.25 + Math.abs(Math.sin(i * 0.55)) * 0.75;
          return (
            <span
              key={i}
              className={`w-[2.5px] rounded-full transition-colors ${barClass(i)}`}
              style={{
                height: `${Math.round(peak * 30)}px`,
                opacity: playing && i === litBars ? 0.5 : 1,
              }}
            />
          );
        })}
      </div>

      <span className="shrink-0 font-mono text-[11px] tabular-nums opacity-80">
        {formatDuration(settled ? elapsed : length)}
        {settled ? ` / ${formatDuration(length)}` : ""}
      </span>
    </div>
  );
}