/**
 * 拍照识景：上传一张旅行照片，视觉模型识别地点与风格，一键填入规划需求。
 * 上传前在浏览器里缩放并重新编码为 JPEG：既减小体积，也去掉 EXIF 中的拍摄位置等隐私信息。
 */
"use client";

import { Camera, ImagePlus, Loader2, MapPin, RefreshCw, Sparkle, X } from "lucide-react";
import { useRef, useState } from "react";
import type { PhotoInsight } from "@/lib/schema";

const MAX_SIDE = 1280;
const MAX_FILE_BYTES = 15 * 1024 * 1024;

export interface PhotoApply {
  city: string;
  interests: PhotoInsight["interests"];
  note: string;
}

async function compress(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", 0.85);
}

type State =
  | { status: "idle" }
  | { status: "working"; preview: string }
  | { status: "done"; preview: string; insight: PhotoInsight }
  | { status: "error"; preview: string | null; message: string };

export function PhotoInspiration({ onApply }: { onApply: (value: PhotoApply) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<State>({ status: "idle" });
  const [applied, setApplied] = useState<string | null>(null);

  const analyze = async (file: File) => {
    setApplied(null);
    if (
      !/^image\/(jpeg|png|webp|heic|heif)$/.test(file.type) ||
      file.size > MAX_FILE_BYTES
    ) {
      setState({
        status: "error",
        preview: null,
        message: "请选择 15MB 以内的 JPG、PNG 或 WebP 照片",
      });
      return;
    }
    let preview: string;
    try {
      preview = await compress(file);
    } catch {
      setState({
        status: "error",
        preview: null,
        message: "这张图片无法读取，换一张试试",
      });
      return;
    }
    setState({ status: "working", preview });
    try {
      const response = await fetch("/api/vision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: preview }),
      });
      const body = (await response.json()) as {
        insight?: PhotoInsight;
        message?: string;
      };
      if (!response.ok || !body.insight) {
        throw new Error(body.message ?? "识别失败，请稍后重试");
      }
      setState({ status: "done", preview, insight: body.insight });
    } catch (error) {
      setState({
        status: "error",
        preview,
        message: error instanceof Error ? error.message : "识别失败，请稍后重试",
      });
    }
  };

  const apply = (insight: PhotoInsight, city: string) => {
    onApply({
      city,
      interests: insight.interests,
      note:
        insight.note || (insight.scene ? `想要照片里这样的感觉：${insight.scene}` : ""),
    });
    setApplied(city);
  };

  const reset = () => {
    setState({ status: "idle" });
    setApplied(null);
    if (input.current) {
      input.current.value = "";
    }
  };

  return (
    <div>
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
        className="sr-only"
        aria-label="上传旅行照片"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) {
            void analyze(file);
          }
        }}
      />
      {state.status === "idle" ? (
        <button
          type="button"
          onClick={() => input.current?.click()}
          className="group flex w-full items-center gap-4 rounded-xl border border-dashed border-line bg-paper/60 px-4 py-3.5 text-left transition-colors hover:border-pine hover:bg-pine-soft/40"
        >
          <span className="grid size-11 shrink-0 place-items-center rounded-full bg-card text-pine shadow-lift transition-transform group-hover:scale-105">
            <ImagePlus size={20} aria-hidden />
          </span>
          <span>
            <span className="block font-medium text-ink">用一张照片找灵感</span>
            <span className="block text-sm text-ink-soft">
              上传在网上看到的美景或自己拍的照片，AI 认出地方和风格，帮你填好需求
            </span>
          </span>
        </button>
      ) : (
        <div className="flex gap-4 rounded-xl border border-line bg-paper/60 p-3 sm:p-4">
          {state.preview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={state.preview}
              alt="上传的照片"
              className="size-24 shrink-0 rounded-lg object-cover sm:size-28"
            />
          ) : null}
          <div className="min-w-0 flex-1" aria-live="polite">
            {state.status === "working" ? (
              <p className="flex items-center gap-2 pt-2 text-sm text-ink-soft">
                <Loader2 size={16} className="animate-spin text-pine" aria-hidden />
                AI 正在看这张照片…
              </p>
            ) : null}
            {state.status === "error" ? (
              <div className="pt-1">
                <p role="alert" className="text-sm text-danger">
                  {state.message}
                </p>
                <button
                  type="button"
                  onClick={() => input.current?.click()}
                  className="mt-2 flex items-center gap-1 text-sm text-pine hover:underline"
                >
                  <RefreshCw size={13} aria-hidden />
                  换一张
                </button>
              </div>
            ) : null}
            {state.status === "done" ? (
              <InsightView
                insight={state.insight}
                applied={applied}
                onApply={(city) => apply(state.insight, city)}
              />
            ) : null}
          </div>
          <button
            type="button"
            onClick={reset}
            aria-label="移除照片"
            className="self-start rounded-md p-1 text-ink-faint hover:bg-paper-deep hover:text-ink"
          >
            <X size={16} />
          </button>
        </div>
      )}
    </div>
  );
}

function InsightView({
  insight,
  applied,
  onApply,
}: {
  insight: PhotoInsight;
  applied: string | null;
  onApply: (city: string) => void;
}) {
  const recognized = insight.city && insight.confidence !== "low";
  const cities = [
    ...(recognized && insight.city
      ? [
          {
            city: insight.city,
            reason: insight.place ? `照片里的${insight.place}` : "照片拍摄地",
          },
        ]
      : []),
    ...insight.suggestions.filter((item) => item.city !== insight.city),
  ].slice(0, 3);
  return (
    <div>
      <p className="flex flex-wrap items-center gap-x-2 text-sm text-ink">
        {recognized ? (
          <>
            <MapPin size={14} className="text-pine" aria-hidden />
            <span>
              看起来是 <b className="font-medium">{insight.place ?? insight.city}</b>
              {insight.place && insight.city ? `（${insight.city}）` : ""}
            </span>
            {insight.confidence === "medium" ? (
              <span className="text-xs text-ink-faint">不太确定</span>
            ) : null}
          </>
        ) : (
          <>
            <Camera size={14} className="text-pine" aria-hidden />
            <span>没认出具体地点，按照片风格推荐</span>
          </>
        )}
      </p>
      {insight.scene ? (
        <p className="mt-1 text-sm text-ink-soft">{insight.scene}</p>
      ) : null}
      {insight.styles.length ? (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {insight.styles.map((style) => (
            <li
              key={style}
              className="rounded-full bg-card px-2 py-0.5 text-xs text-ink-soft"
            >
              {style}
            </li>
          ))}
        </ul>
      ) : null}
      {cities.length ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {cities.map((item) => (
            <button
              key={item.city}
              type="button"
              onClick={() => onApply(item.city)}
              aria-pressed={applied === item.city}
              title={item.reason}
              className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm transition-colors ${
                applied === item.city
                  ? "border-pine bg-pine text-white"
                  : "border-line bg-card text-ink hover:border-pine"
              }`}
            >
              <Sparkle size={13} aria-hidden />去{item.city}
              <span
                className={`hidden text-xs sm:inline ${applied === item.city ? "text-white/80" : "text-ink-faint"}`}
              >
                {item.reason}
              </span>
            </button>
          ))}
        </div>
      ) : null}
      {applied ? (
        <p className="mt-2 text-xs text-pine">
          已填入目的地、兴趣和补充说明，可以继续修改。
        </p>
      ) : null}
    </div>
  );
}
