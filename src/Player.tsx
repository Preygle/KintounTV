// In-app HLS player with custom controls. hls.js is loaded on first use so the rest of the app
// stays light. Controls and cursor hide after a short idle while playing, including in fullscreen.
import { useCallback, useEffect, useRef, useState } from "react";
import type HlsType from "hls.js";
import {
  Back10Icon,
  CheckIcon,
  ChevronIcon,
  Forward10Icon,
  FullscreenIcon,
  NextIcon,
  PauseIcon,
  PlayIcon,
  SettingsIcon,
  VolumeIcon,
} from "./icons";
import { getPlayerPrefs, setPlayerPrefs, usePlayerPrefs } from "./progress";
import { fetchSkips, SKIP_LABEL, type SkipLookup, type SkipSegment } from "./skips";
import { usePreview } from "./trickplay";

declare global {
  interface Window {
    // Provided by the desktop app: turns the window itself borderless/fullscreen.
    kintounSetFullscreen?: (on: boolean) => Promise<void>;
  }
}

interface PlayerProps {
  // null while the next stream is being looked up: the player (and fullscreen) stays mounted.
  src: string | null;
  overlay?: React.ReactNode; // loading / error state shown inside the player
  skip?: SkipLookup | null; // for intro/credits timestamps
  startAt?: number;
  title?: string;
  subtitle?: string;
  lang?: string;
  onProgress?: (time: number, duration: number, thumb?: string) => void;
  onEnded?: () => void;
  onNext?: () => void;
  onPrev?: () => void;
  onFatalError?: (message: string) => void;
}

interface QualityLevel {
  index: number;
  height: number;
}

type Menu = "main" | "quality" | "speed" | "subtitles";

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
const IDLE_MS = 2500;
const PROGRESS_EVERY = 5;
const THUMB_EVERY = 30;

function formatTime(s: number) {
  if (!Number.isFinite(s) || s < 0) s = 0;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60)
    .toString()
    .padStart(2, "0");
  return h ? `${h}:${m.toString().padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

// A small frame for the Continue Watching / History cards (the video is same-origin via the relay).
function captureFrame(video: HTMLVideoElement): string | undefined {
  if (!video.videoWidth || video.readyState < 2) return undefined;
  const canvas = document.createElement("canvas");
  canvas.width = 320;
  canvas.height = 180;
  const ctx = canvas.getContext("2d");
  if (!ctx) return undefined;
  const scale = Math.max(320 / video.videoWidth, 180 / video.videoHeight);
  const w = video.videoWidth * scale;
  const h = video.videoHeight * scale;
  try {
    ctx.drawImage(video, (320 - w) / 2, (180 - h) / 2, w, h);
    // Skip near-black frames (intros, fades) so cards don't end up as black boxes.
    const pixels = ctx.getImageData(0, 0, 320, 180).data;
    let sum = 0;
    let n = 0;
    for (let i = 0; i < pixels.length; i += 4 * 97) {
      sum += 0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2];
      n++;
    }
    if (sum / n < 18) return undefined;
    return canvas.toDataURL("image/jpeg", 0.62);
  } catch {
    return undefined;
  }
}

export default function Player({ src, overlay, skip, startAt = 0, title, subtitle, lang, onProgress, onEnded, onNext, onPrev, onFatalError }: PlayerProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const seekRef = useRef<HTMLDivElement>(null);
  const hlsRef = useRef<HlsType | null>(null);
  const callbacks = useRef({ onProgress, onEnded, onFatalError, onNext, onPrev });
  callbacks.current = { onProgress, onEnded, onFatalError, onNext, onPrev };
  const prefs = usePlayerPrefs();

  const [paused, setPaused] = useState(true);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [waiting, setWaiting] = useState(true);
  const [levels, setLevels] = useState<QualityLevel[]>([]);
  const [autoLevel, setAutoLevel] = useState(true);
  const [playingHeight, setPlayingHeight] = useState<number | null>(null);
  const [subTracks, setSubTracks] = useState<{ id: number; name: string }[]>([]);
  const [subTrack, setSubTrack] = useState(-1);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [idle, setIdle] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [scrub, setScrub] = useState<number | null>(null);
  const [hover, setHover] = useState<number | null>(null); // seek-bar position under the pointer (0–1)
  const [segments, setSegments] = useState<SkipSegment[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const [undoAt, setUndoAt] = useState<number | null>(null); // where an automatic skip started
  const skippedRef = useRef(new Set<string>());

  // ---- loading -------------------------------------------------------------------------------
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let hls: HlsType | null = null;
    let cancelled = false;
    setWaiting(true);
    setLevels([]);
    setSubTracks([]);
    // Same player instance across episodes: reset per-stream state.
    setTime(0);
    setDuration(0);
    setBuffered(0);
    setPlayingHeight(null);
    setMenu(null);
    setSegments([]);
    skippedRef.current = new Set();
    if (!src) {
      setWaiting(false);
      return;
    }

    const start = () => {
      const p = getPlayerPrefs();
      video.defaultPlaybackRate = video.playbackRate = p.speed;
      video.volume = p.volume;
      video.muted = p.muted;
      if (startAt > 0) video.currentTime = startAt;
      video.play().catch(() => {
        // Autoplay can be refused; the big play button stays available.
      });
    };

    (async () => {
      const { default: Hls } = await import("hls.js");
      if (cancelled) return;
      if (Hls.isSupported()) {
        hls = new Hls({
          // Bounded buffers keep memory flat during long sessions.
          maxBufferLength: 30,
          maxMaxBufferLength: 60,
          backBufferLength: 30,
          enableWorker: true,
          startFragPrefetch: true,
          // In Auto, don't fetch 1080p for a small window; fullscreen raises the cap.
          capLevelToPlayerSize: true,
        });
        hlsRef.current = hls;
        let mediaRecoveries = 0;
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          if (!hls) return;
          const byHeight = new Map<number, QualityLevel>();
          hls.levels.forEach((l, index) => {
            const prev = byHeight.get(l.height);
            if (!prev || l.bitrate > hls!.levels[prev.index].bitrate) byHeight.set(l.height, { index, height: l.height });
          });
          const list = [...byHeight.values()].sort((a, b) => b.height - a.height);
          setLevels(list);
          const q = getPlayerPrefs().quality;
          if (q !== "auto" && list.length > 1) {
            const pick = list.find((l) => l.height <= q) ?? list[list.length - 1];
            hls.currentLevel = pick.index;
            setAutoLevel(false);
          } else {
            setAutoLevel(true);
          }
          setSubTracks(hls.subtitleTracks.map((t, id) => ({ id, name: t.name || t.lang || `Track ${id + 1}` })));
          start();
        });
        hls.on(Hls.Events.LEVEL_SWITCHED, (_e, data) => setPlayingHeight(hls?.levels[data.level]?.height ?? null));
        hls.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, () => {
          if (hls) setSubTracks(hls.subtitleTracks.map((t, id) => ({ id, name: t.name || t.lang || `Track ${id + 1}` })));
        });
        hls.on(Hls.Events.ERROR, (_e, data) => {
          if (!data.fatal || !hls) return;
          if (data.type === Hls.ErrorTypes.MEDIA_ERROR && mediaRecoveries++ < 2) {
            hls.recoverMediaError();
          } else {
            callbacks.current.onFatalError?.(`Playback failed (${data.details})`);
          }
        });
        hls.loadSource(src);
        hls.attachMedia(video);
      } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = src;
        video.addEventListener("loadedmetadata", start, { once: true });
      } else {
        callbacks.current.onFatalError?.("This system cannot play HLS video.");
      }
    })();

    return () => {
      cancelled = true;
      hls?.destroy();
      hlsRef.current = null;
      video.removeAttribute("src");
      video.load();
    };
  }, [src, startAt]);

  // ---- media state ---------------------------------------------------------------------------
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let lastSaved = 0;
    let lastThumb = -THUMB_EVERY;
    const report = (withThumb: boolean) => {
      // Ignore events from a stream being torn down (no duration yet / anymore).
      if (!Number.isFinite(video.duration) || video.duration <= 0) return;
      const thumb = withThumb ? captureFrame(video) : undefined;
      if (withThumb) lastThumb = video.currentTime;
      lastSaved = video.currentTime;
      callbacks.current.onProgress?.(video.currentTime, video.duration || 0, thumb);
    };
    const updateBuffered = () => {
      const t = video.currentTime;
      for (let i = 0; i < video.buffered.length; i++) {
        if (video.buffered.start(i) <= t + 0.5 && video.buffered.end(i) >= t) {
          setBuffered(video.buffered.end(i));
          return;
        }
      }
      setBuffered(t);
    };
    const handlers: Record<string, () => void> = {
      play: () => setPaused(false),
      pause: () => {
        setPaused(true);
        if (video.currentTime > 0) report(true);
      },
      timeupdate: () => {
        setTime(video.currentTime);
        updateBuffered();
        if (Math.abs(video.currentTime - lastThumb) >= THUMB_EVERY) report(true);
        else if (Math.abs(video.currentTime - lastSaved) >= PROGRESS_EVERY) report(false);
      },
      durationchange: () => setDuration(video.duration || 0),
      progress: updateBuffered,
      waiting: () => setWaiting(true),
      playing: () => setWaiting(false),
      canplay: () => setWaiting(false),
      seeking: () => setWaiting(true),
      seeked: () => setWaiting(false),
      ended: () => callbacks.current.onEnded?.(),
      volumechange: () => setPlayerPrefs({ volume: video.volume, muted: video.muted }),
    };
    for (const [event, fn] of Object.entries(handlers)) video.addEventListener(event, fn);
    return () => {
      for (const [event, fn] of Object.entries(handlers)) video.removeEventListener(event, fn);
    };
  }, []);

  // ---- controls --------------------------------------------------------------------------------
  // Controls hide IDLE_MS after the last mouse/keyboard activity, and also after playback starts
  // or resumes, so they vanish even when nothing moves (e.g. after Next or a keyboard shortcut).
  const idleTimer = useRef<number>();
  const poke = useCallback(() => {
    setIdle(false);
    window.clearTimeout(idleTimer.current);
    idleTimer.current = window.setTimeout(() => setIdle(true), IDLE_MS);
  }, []);
  useEffect(() => {
    const video = videoRef.current;
    video?.addEventListener("play", poke);
    return () => {
      video?.removeEventListener("play", poke);
      window.clearTimeout(idleTimer.current);
    };
  }, [poke]);
  useEffect(() => {
    if (!menu) poke();
  }, [menu, poke]);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) video.play().catch(() => {});
    else video.pause();
  }, []);

  const seekBy = useCallback((delta: number) => {
    const video = videoRef.current;
    if (!video || !Number.isFinite(video.duration)) return;
    video.currentTime = Math.min(Math.max(0, video.currentTime + delta), video.duration - 0.5);
  }, []);

  const setVolume = useCallback((v: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.volume = Math.min(1, Math.max(0, v));
    video.muted = video.volume === 0;
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else rootRef.current?.requestFullscreen().catch(() => {});
  }, []);

  // Keep the desktop window in sync with the page's fullscreen state.
  useEffect(() => {
    const sync = () => {
      const on = document.fullscreenElement === rootRef.current;
      setFullscreen(on);
      window.kintounSetFullscreen?.(document.fullscreenElement != null).catch(() => {});
    };
    document.addEventListener("fullscreenchange", sync);
    return () => {
      document.removeEventListener("fullscreenchange", sync);
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      window.kintounSetFullscreen?.(false).catch(() => {});
    };
  }, []);

  // Keyboard shortcuts (ignored while typing in a text field).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isRange = target instanceof HTMLInputElement && target.type === "range";
      if ((target instanceof HTMLInputElement && !isRange) || target instanceof HTMLTextAreaElement) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (isRange && e.key.startsWith("Arrow")) return; // the volume slider handles its own arrows
      const video = videoRef.current;
      if (!video) return;
      const actions: Record<string, () => void> = {
        " ": togglePlay,
        k: togglePlay,
        arrowright: () => seekBy(10),
        l: () => seekBy(10),
        arrowleft: () => seekBy(-10),
        j: () => seekBy(-10),
        arrowup: () => setVolume(video.volume + 0.1),
        arrowdown: () => setVolume(video.volume - 0.1),
        m: () => (video.muted = !video.muted),
        f: toggleFullscreen,
        n: () => callbacks.current.onNext?.(),
        p: () => callbacks.current.onPrev?.(),
        escape: () => setMenu(null),
      };
      const action = actions[e.key.toLowerCase()];
      if (!action) return;
      e.preventDefault();
      // Space on a focused button would also "click" it on keyup.
      if (document.activeElement instanceof HTMLElement && rootRef.current?.contains(document.activeElement)) document.activeElement.blur();
      action();
      poke();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePlay, seekBy, setVolume, toggleFullscreen, poke]);

  // Mouse: single click toggles play, double click toggles fullscreen (without a play/pause flicker).
  // Touch has its own gestures (onSurfaceTap), so clicks synthesized from taps are ignored.
  const clickTimer = useRef<number>();
  const touched = useRef(false);
  const hiddenAtTouch = useRef(false); // read before the player's own pointerdown shows the controls
  // The touch currently down: only a short, still, single-finger touch counts as a tap.
  const touchDown = useRef<{ id: number; x: number; y: number; at: number; fingers: number } | null>(null);
  const onSurfacePointerDown = (e: React.PointerEvent) => {
    touched.current = e.pointerType !== "mouse";
    if (e.pointerType === "mouse") return;
    hiddenAtTouch.current = idle;
    const fingers = (touchDown.current?.fingers ?? 0) + 1;
    touchDown.current = { id: e.pointerId, x: e.clientX, y: e.clientY, at: performance.now(), fingers };
  };
  const onSurfaceClick = () => {
    if (touched.current) return;
    if (menu) {
      setMenu(null);
      return;
    }
    window.clearTimeout(clickTimer.current);
    clickTimer.current = window.setTimeout(togglePlay, 220);
  };
  const onSurfaceDoubleClick = () => {
    // Phones double-tap to seek; fullscreen there is the button only.
    if (touched.current || window.matchMedia("(hover: none)").matches) return;
    window.clearTimeout(clickTimer.current);
    toggleFullscreen();
  };

  // Touch: a tap in the middle plays/pauses; a double tap on the left or right third goes back or
  // forward 10 s, and each further quick tap there adds another 10 s. A single tap at the sides shows
  // or hides the controls. Drags, long presses and two-finger touches are not taps.
  const TAP_SLOP = 12; // px a finger may move and still tap
  const TAP_HOLD = 350; // ms
  const DOUBLE_GAP = 280; // ms between the two taps of a double tap
  const DOUBLE_DIST = 70; // px between them
  const STREAK_GAP = 500; // ms for each further tap to add 10 s
  const tapRef = useRef<{ at: number; x: number; y: number; side: "left" | "right" | null; streak: boolean }>({ at: 0, x: 0, y: 0, side: null, streak: false });
  const tapTimer = useRef<number>();
  const [seekHint, setSeekHint] = useState<{ side: "left" | "right"; seconds: number; key: number } | null>(null);
  const hintTimer = useRef<number>();
  const onSurfaceTap = (e: React.PointerEvent<HTMLVideoElement>) => {
    if (e.pointerType === "mouse") return;
    const down = touchDown.current;
    touchDown.current = null;
    if (!down || down.id !== e.pointerId || down.fingers > 1) return;
    if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > TAP_SLOP || performance.now() - down.at > TAP_HOLD) return;
    if (menu) {
      setMenu(null);
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const side = x < 0.35 ? "left" : x > 0.65 ? "right" : null;
    const now = performance.now();
    const last = tapRef.current;
    window.clearTimeout(tapTimer.current);
    if (!side) {
      tapRef.current = { at: now, x: e.clientX, y: e.clientY, side: null, streak: false };
      togglePlay();
      poke();
      return;
    }
    const near = Math.hypot(e.clientX - last.x, e.clientY - last.y) < (last.streak ? DOUBLE_DIST * 2 : DOUBLE_DIST);
    const repeat = last.side === side && near && now - last.at < (last.streak ? STREAK_GAP : DOUBLE_GAP);
    tapRef.current = { at: now, x: e.clientX, y: e.clientY, side, streak: repeat };
    if (repeat) {
      const delta = side === "left" ? -10 : 10;
      seekBy(delta);
      window.clearTimeout(hintTimer.current);
      setSeekHint((h) => ({ side, seconds: (h && h.side === side ? h.seconds : 0) + 10, key: now }));
      hintTimer.current = window.setTimeout(() => setSeekHint(null), 700);
      return;
    }
    // Wait to see whether a second tap follows before treating it as a single tap.
    tapTimer.current = window.setTimeout(() => {
      if (tapRef.current.at !== now) return;
      if (hiddenAtTouch.current) poke();
      else setIdle(true);
    }, DOUBLE_GAP);
  };

  // ---- intro / recap / credits ------------------------------------------------------------------
  const skipKey = skip && src ? `${skip.postId}:${skip.episode}` : null;
  const roundedDuration = Math.round(duration);
  useEffect(() => {
    if (!skip || !src || !roundedDuration) return;
    let cancelled = false;
    fetchSkips(skip, roundedDuration).then((s) => !cancelled && setSegments(s));
    return () => {
      cancelled = true;
    };
    // skip object identity changes every render; skipKey captures what matters.
  }, [skipKey, roundedDuration]);

  const activeSegment = segments.find((s) => time >= s.start && time < s.end - 0.5);
  const segKey = (s: SkipSegment) => `${s.kind}:${s.start}`;
  // While a stream is starting, hls.js can move the video back to its start position after our seek,
  // so the skip is checked and repeated (twice at most) before "Skipped …" is shown. A position the
  // viewer has moved to themselves (outside the segment) is left alone.
  const skipCheck = useRef<number>();
  const doSkip = useCallback((seg: SkipSegment, auto: boolean) => {
    const video = videoRef.current;
    if (!video) return;
    skippedRef.current.add(segKey(seg));
    const from = video.currentTime;
    const target = Math.min(seg.end, (video.duration || seg.end) - 0.3);
    video.currentTime = target;
    setToast(null);
    setUndoAt(null);
    window.clearTimeout(skipCheck.current);
    let tries = 0;
    const check = () => {
      const t = video.currentTime;
      if (t >= target - 1) {
        if (auto) {
          setToast(`Skipped ${seg.kind}`);
          setUndoAt(from);
        }
      } else if (t >= seg.start - 2 && tries++ < 2) {
        video.currentTime = target;
        skipCheck.current = window.setTimeout(check, 1200);
      }
    };
    skipCheck.current = window.setTimeout(check, 800);
  }, []);
  useEffect(() => () => window.clearTimeout(skipCheck.current), []);
  // Auto-skip: timings confirmed for this video (exact), plus intros, recaps and credits of a believable
  // length from any source. Each automatic skip offers "Undo" for a few seconds.
  const autoSkippable = (seg: SkipSegment) => seg.exact || seg.end - seg.start <= (seg.kind === "credits" ? 240 : 180);
  useEffect(() => {
    if (!activeSegment || !prefs.autoSkip || !autoSkippable(activeSegment) || paused) return;
    if (skippedRef.current.has(segKey(activeSegment))) return; // user went back into it on purpose
    doSkip(activeSegment, true);
  }, [activeSegment, prefs.autoSkip, paused, doSkip]);
  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => {
      setToast(null);
      setUndoAt(null);
    }, undoAt === null ? 2500 : 5000);
    return () => window.clearTimeout(t);
  }, [toast, undoAt]);
  const undoSkip = () => {
    const video = videoRef.current;
    if (video && undoAt !== null) video.currentTime = undoAt; // already marked skipped: it won't skip again
    setToast(null);
    setUndoAt(null);
  };
  const showSkip = !!activeSegment && !(prefs.autoSkip && autoSkippable(activeSegment) && !skippedRef.current.has(segKey(activeSegment)));

  // ---- seek bar ----------------------------------------------------------------------------------
  const ratioAt = (clientX: number) => {
    const rect = seekRef.current!.getBoundingClientRect();
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  };
  const onSeekDown = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const r = ratioAt(e.clientX);
    setScrub(r);
    setHover(r); // touch has no hover: the preview follows the finger while dragging
  };
  const onSeekMove = (e: React.PointerEvent) => {
    const r = ratioAt(e.clientX);
    setHover(r);
    if (scrub !== null) setScrub(r);
  };
  const onSeekUp = (e: React.PointerEvent) => {
    if (e.pointerType !== "mouse") setHover(null);
    if (scrub === null) return;
    const video = videoRef.current;
    if (video && duration) video.currentTime = ratioAt(e.clientX) * duration;
    setScrub(null);
  };

  // ---- settings ----------------------------------------------------------------------------------
  const chooseQuality = (level: QualityLevel | null) => {
    const hls = hlsRef.current;
    if (!hls) return;
    hls.currentLevel = level ? level.index : -1;
    setAutoLevel(!level);
    setPlayerPrefs({ quality: level ? level.height : "auto" });
    setMenu(null);
  };
  const chooseSpeed = (speed: number) => {
    const video = videoRef.current;
    if (video) video.defaultPlaybackRate = video.playbackRate = speed;
    setPlayerPrefs({ speed });
    setMenu(null);
  };
  const chooseSubtitle = (id: number) => {
    const hls = hlsRef.current;
    if (hls) {
      hls.subtitleTrack = id;
      hls.subtitleDisplay = id >= 0;
    }
    setSubTrack(id);
    setMenu(null);
  };

  const qualityLabel = autoLevel
    ? `Auto${playingHeight ? ` (${playingHeight}p)` : ""}`
    : `${levels.find((l) => l.index === hlsRef.current?.currentLevel)?.height ?? playingHeight ?? ""}p`;
  const speedLabel = prefs.speed === 1 ? "Normal" : `${prefs.speed}×`;
  const subtitleLabel = subTracks.length
    ? subTrack >= 0
      ? subTracks[subTrack]?.name
      : "Off"
    : lang === "sub"
      ? "Burned in"
      : "None";

  const shown = scrub ?? (duration ? time / duration : 0);
  const peek = duration > 0 ? (scrub ?? hover) : null;
  const preview = usePreview(src, peek === null ? null : peek * duration);
  const hideUi = idle && !paused && !menu && scrub === null;
  const volumeLevel = prefs.muted ? 0 : prefs.volume;

  return (
    <div
      ref={rootRef}
      className={`player ${hideUi ? "is-idle" : ""} ${fullscreen ? "is-fullscreen" : ""}`}
      onPointerMove={poke}
      onPointerDown={poke}
      // Mouse only: on touch screens every lifted finger "leaves", which hid the controls mid-tap.
      onPointerLeave={(e) => e.pointerType === "mouse" && !paused && setIdle(true)}
    >
      <video
        ref={videoRef}
        className="player-video"
        playsInline
        preload="auto"
        onPointerDown={onSurfacePointerDown}
        onPointerUp={onSurfaceTap}
        onPointerCancel={() => (touchDown.current = null)}
        onClick={onSurfaceClick}
        onDoubleClick={onSurfaceDoubleClick}
      />
      {seekHint && (
        <div key={seekHint.key} className={`player-seek-hint ${seekHint.side}`} aria-hidden="true">
          {seekHint.side === "left" ? <Back10Icon /> : <Forward10Icon />}
          <span>{seekHint.seconds} seconds</span>
        </div>
      )}

      {src && waiting && !paused && <div className="player-spinner" aria-label="Loading" />}
      {src && paused && !waiting && !overlay && (
        <button className="player-bigplay" onClick={togglePlay} aria-label="Play">
          <PlayIcon />
        </button>
      )}

      {overlay && <div className="player-overlay">{overlay}</div>}
      {toast && (
        <div className={`player-toast${undoAt !== null ? " has-undo" : ""}`}>
          {toast}
          {undoAt !== null && (
            <button onClick={undoSkip} onPointerUp={(e) => e.stopPropagation()}>
              Undo
            </button>
          )}
        </div>
      )}
      {showSkip && (
        <button className="player-skip" onClick={() => doSkip(activeSegment!, false)}>
          {SKIP_LABEL[activeSegment!.kind]} <NextIcon />
        </button>
      )}

      {(title || subtitle) && (
        <div className="player-top">
          {title && <strong>{title}</strong>}
          {subtitle && <span>{subtitle}</span>}
        </div>
      )}

      <div className="player-controls">
        <div
          ref={seekRef}
          className={`seek ${scrub !== null ? "dragging" : ""}`}
          onPointerDown={onSeekDown}
          onPointerMove={onSeekMove}
          onPointerUp={onSeekUp}
          onPointerLeave={() => setHover(null)}
          role="slider"
          aria-label="Seek"
          aria-valuemin={0}
          aria-valuemax={Math.round(duration)}
          aria-valuenow={Math.round(time)}
        >
          <div className="seek-track">
            {duration > 0 &&
              segments.map((s) => (
                <div key={s.kind} className={`seek-seg ${s.kind}`} style={{ left: `${(s.start / duration) * 100}%`, width: `${((s.end - s.start) / duration) * 100}%` }} />
              ))}
            <div className="seek-buffered" style={{ width: `${duration ? (buffered / duration) * 100 : 0}%` }} />
            <div className="seek-played" style={{ width: `${shown * 100}%` }} />
          </div>
          <div className="seek-thumb" style={{ left: `${shown * 100}%` }} />
          {peek !== null && (
            // Kept inside the bar: the centre is clamped half a tip's width from either end.
            <div className={`seek-tip${preview.available ? " has-preview" : ""}`} style={{ left: `clamp(var(--tip-half), ${peek * 100}%, calc(100% - var(--tip-half)))` }}>
              {preview.available && <span className="seek-preview">{preview.image && <img src={preview.image} alt="" />}</span>}
              <span className="seek-time">{formatTime(peek * duration)}</span>
            </div>
          )}
        </div>

        <div className="player-row">
          <button className="pc-btn" onClick={togglePlay} aria-label={paused ? "Play" : "Pause"}>
            {paused ? <PlayIcon /> : <PauseIcon />}
          </button>
          <button className="pc-btn" onClick={() => seekBy(-10)} aria-label="Back 10 seconds">
            <Back10Icon />
          </button>
          <button className="pc-btn" onClick={() => seekBy(10)} aria-label="Forward 10 seconds">
            <Forward10Icon />
          </button>
          {onNext && (
            <button className="pc-btn" onClick={onNext} aria-label="Next episode">
              <NextIcon />
            </button>
          )}
          <div className="pc-volume">
            <button className="pc-btn" onClick={() => videoRef.current && (videoRef.current.muted = !videoRef.current.muted)} aria-label={prefs.muted ? "Unmute" : "Mute"}>
              <VolumeIcon level={volumeLevel} />
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={volumeLevel}
              onChange={(e) => setVolume(Number(e.target.value))}
              onPointerUp={(e) => e.currentTarget.blur()}
              style={{ "--pct": `${volumeLevel * 100}%` } as React.CSSProperties}
              aria-label="Volume"
            />
          </div>
          <span className="pc-time">
            {formatTime(scrub !== null ? scrub * duration : time)} / {formatTime(duration)}
          </span>
          <span className="pc-spacer" />
          {prefs.speed !== 1 && <span className="pc-badge">{speedLabel}</span>}
          <button className={`pc-btn ${menu ? "active" : ""}`} onClick={() => setMenu(menu ? null : "main")} aria-label="Settings" aria-expanded={!!menu}>
            <SettingsIcon />
          </button>
          <button className="pc-btn" onClick={toggleFullscreen} aria-label={fullscreen ? "Exit fullscreen" : "Fullscreen"}>
            <FullscreenIcon exit={fullscreen} />
          </button>
        </div>
      </div>

      {menu && (
        <div className="player-menu" role="menu">
          {menu === "main" && (
            <>
              <button className="pm-item" onClick={() => setMenu("quality")} disabled={levels.length < 2}>
                <span>Quality</span>
                <em>{qualityLabel}</em>
                {levels.length > 1 && <ChevronIcon />}
              </button>
              <button className="pm-item" onClick={() => setMenu("speed")}>
                <span>Playback speed</span>
                <em>{speedLabel}</em>
                <ChevronIcon />
              </button>
              <button className="pm-item" onClick={() => setMenu("subtitles")}>
                <span>Subtitles</span>
                <em>{subtitleLabel}</em>
                <ChevronIcon />
              </button>
              <button className="pm-item" onClick={() => setPlayerPrefs({ autoSkip: !prefs.autoSkip })} aria-pressed={prefs.autoSkip}>
                <span>Skip intro &amp; credits</span>
                <em>
                  {prefs.autoSkip ? "Auto" : "Button"}
                  {src && duration > 0 && !segments.length ? " · no timings" : ""}
                </em>
              </button>
            </>
          )}
          {menu !== "main" && (
            <button className="pm-head" onClick={() => setMenu("main")}>
              <ChevronIcon back /> {menu === "quality" ? "Quality" : menu === "speed" ? "Playback speed" : "Subtitles"}
            </button>
          )}
          {menu === "quality" && (
            <>
              <button className="pm-item" role="menuitemradio" aria-checked={autoLevel} onClick={() => chooseQuality(null)}>
                <span>Auto{autoLevel && playingHeight ? ` (${playingHeight}p)` : ""}</span>
                {autoLevel && <CheckIcon />}
              </button>
              {levels.map((l) => {
                const active = !autoLevel && hlsRef.current?.currentLevel === l.index;
                return (
                  <button key={l.index} className="pm-item" role="menuitemradio" aria-checked={active} onClick={() => chooseQuality(l)}>
                    <span>
                      {l.height}p{l.height >= 720 && <small className="pm-hd">HD</small>}
                    </span>
                    {active && <CheckIcon />}
                  </button>
                );
              })}
            </>
          )}
          {menu === "speed" &&
            SPEEDS.map((s) => (
              <button key={s} className="pm-item" role="menuitemradio" aria-checked={prefs.speed === s} onClick={() => chooseSpeed(s)}>
                <span>{s === 1 ? "Normal" : `${s}×`}</span>
                {prefs.speed === s && <CheckIcon />}
              </button>
            ))}
          {menu === "subtitles" &&
            (subTracks.length ? (
              <>
                <button className="pm-item" role="menuitemradio" aria-checked={subTrack < 0} onClick={() => chooseSubtitle(-1)}>
                  <span>Off</span>
                  {subTrack < 0 && <CheckIcon />}
                </button>
                {subTracks.map((t) => (
                  <button key={t.id} className="pm-item" role="menuitemradio" aria-checked={subTrack === t.id} onClick={() => chooseSubtitle(t.id)}>
                    <span>{t.name}</span>
                    {subTrack === t.id && <CheckIcon />}
                  </button>
                ))}
              </>
            ) : (
              <p className="pm-note">
                {lang === "sub"
                  ? "Subtitles are burned into this video (SUB servers), so they can't be turned off or restyled."
                  : "This server has no subtitle tracks. Choose a SUB server for subtitles."}
              </p>
            ))}
        </div>
      )}
    </div>
  );
}
