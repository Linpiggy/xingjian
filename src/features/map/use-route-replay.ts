import { useCallback, useEffect, useState } from "react";
import { replayFrame, type ReplayTrack } from "./route-replay";

type State = { track: ReplayTrack; elapsed: number; playing: boolean; speed: number };

export function useRouteReplay(track: ReplayTrack) {
  const [state, setState] = useState<State>({
    track,
    elapsed: 0,
    playing: false,
    speed: 1,
  });
  const [reduced, setReduced] = useState(false);
  const current =
    state.track === track ? state : { track, elapsed: 0, playing: false, speed: 1 };
  const update = useCallback(
    (change: Partial<Omit<State, "track">>) => {
      setState((previous) => ({
        ...(previous.track === track
          ? previous
          : { track, elapsed: 0, playing: false, speed: 1 }),
        ...change,
      }));
    },
    [track],
  );
  const pause = useCallback(() => update({ playing: false }), [update]);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => {
      setReduced(media.matches);
      if (media.matches) {
        pause();
      }
    };
    const visibility = () => {
      if (document.hidden) {
        pause();
      }
    };
    sync();
    media.addEventListener("change", sync);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      media.removeEventListener("change", sync);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [pause]);
  useEffect(() => {
    if (!current.playing || reduced || !track.durationMs) {
      return;
    }
    let frame: number;
    let previous: number | null = null;
    const advance = (now: number) => {
      const delta = previous === null ? 0 : Math.max(0, now - previous) * current.speed;
      previous = now;
      setState((value) => {
        if (value.track !== track || !value.playing) {
          return value;
        }
        const elapsed = Math.min(track.durationMs, value.elapsed + delta);
        return { ...value, elapsed, playing: elapsed < track.durationMs };
      });
      frame = requestAnimationFrame(advance);
    };
    frame = requestAnimationFrame(advance);
    return () => cancelAnimationFrame(frame);
  }, [current.playing, current.speed, track, reduced]);
  const sample = replayFrame(track, current.elapsed);
  return {
    ...current,
    reduced,
    sample,
    cursor: current.playing || current.elapsed > 0 ? sample.position : null,
    pause,
    toggle: () => {
      if (!reduced && track.parts.length) {
        update({
          playing: !current.playing,
          elapsed: current.elapsed >= track.durationMs ? 0 : current.elapsed,
        });
      }
    },
    seek: (elapsed: number) =>
      update({
        elapsed: Math.max(0, Math.min(track.durationMs, elapsed)),
        playing: false,
      }),
    setSpeed: (speed: number) => {
      if ([1, 2, 4].includes(speed)) {
        update({ speed });
      }
    },
  };
}
