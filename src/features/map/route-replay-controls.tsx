import { Pause, Play, RotateCcw, SkipBack, SkipForward } from "lucide-react";
import type { ReplayTrack } from "./route-replay";
import type { useRouteReplay } from "./use-route-replay";
import { Button } from "@/components/arc/button/button";
import { ArcIcon } from "@/components/arc/icon/icon";
import { Select, Input } from "@/components/arc/input/input";

export function RouteReplayControls({
  track,
  replay,
}: {
  track: ReplayTrack;
  replay: ReturnType<typeof useRouteReplay>;
}) {
  const part = track.parts[replay.sample.index];
  return (
    <section className="route-replay" aria-label="全天路线演示">
      <div className="route-replay-actions">
        <Button
          variant="primary"
          type="button"

          disabled={!track.parts.length || replay.reduced}
          onClick={replay.toggle}
        >
          {replay.playing ? (
            <ArcIcon icon={Pause} size="md" aria-hidden="true" />
          ) : (
            <ArcIcon icon={Play} size="md" aria-hidden="true" />
          )}
          {replay.playing
            ? "暂停演示"
            : replay.elapsed >= track.durationMs && track.parts.length
              ? "重新播放"
              : "播放全天路线"}
        </Button>
        <Button
          type="button"

          aria-label="回到路线起点"
          disabled={!track.parts.length || replay.elapsed === 0}
          onClick={() => replay.seek(0)}
        >
          <ArcIcon icon={RotateCcw} size="md" aria-hidden="true" />
        </Button>
        <label>
          演示速度
          <Select
            aria-label="路线演示速度"
            value={replay.speed}
            onChange={(event) => replay.setSpeed(Number(event.target.value))}
          >
            <option value={1}>1×</option>
            <option value={2}>2×</option>
            <option value={4}>4×</option>
          </Select>
        </label>
      </div>
      <div className="route-replay-progress">
        <Button
          type="button"

          aria-label="查看前一段轨迹"
          disabled={replay.sample.index <= 0}
          onClick={() => replay.seek(track.parts[replay.sample.index - 1].startMs)}
        >
          <ArcIcon icon={SkipBack} size="sm" aria-hidden="true" />
        </Button>
        <Input
          type="range"
          min={0}
          max={track.durationMs || 1}
          step="any"
          value={replay.elapsed}
          disabled={!track.parts.length}
          aria-label="路线演示进度"
          aria-valuetext={`${Math.round(track.durationMs ? (replay.elapsed / track.durationMs) * 100 : 0)}%`}
          onChange={(event) => replay.seek(Number(event.target.value))}
        />
        <Button
          type="button"

          aria-label="查看后一段轨迹"
          disabled={!track.parts.length || replay.sample.index >= track.parts.length - 1}
          onClick={() => replay.seek(track.parts[replay.sample.index + 1].startMs)}
        >
          <ArcIcon icon={SkipForward} size="sm" aria-hidden="true" />
        </Button>
      </div>
      <p className="route-replay-current" aria-live="polite">
        {!track.parts.length
          ? "没有可演示的轨迹，不会用地点间直线代替路线。"
          : replay.sample.gap
            ? "此处轨迹断开；下一段单独演示，不补画连接线。"
            : `${replay.sample.finished ? "演示结束 · " : ""}${(part?.legIndex ?? 0) + 1} → ${(part?.legIndex ?? 0) + 2} 站 · ${part?.from ?? ""} → ${part?.to ?? ""}`}
      </p>
      {track.parts[replay.sample.index]?.suggested === "transit" && (
        <p className="route-replay-note">
          这一段已超过 2.5
          km，建议改乘公交或打车；当前轨迹仍是实际步行路线，不是公交方案。
        </p>
      )}
      <p className="route-replay-note">
        {replay.reduced
          ? "已启用减少动态效果，可用进度条或前后段按钮检查。"
          : "按已有轨迹顺序演示，播放速度不代表实际用时。"}
        {track.missingLegs.length > 0 &&
          ` ${track.missingLegs.length} 段缺少可演示轨迹，未补画。`}
      </p>
    </section>
  );
}
