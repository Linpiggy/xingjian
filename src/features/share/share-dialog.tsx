"use client";

import {
  Check,
  Copy,
  Download,
  ExternalLink,
  Link2,
  Loader2,
  Share,
  X,
} from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { Trip, TripRequest } from "@/lib/schema";
import { encodeShare } from "@/lib/share";
import { renderPoster } from "./poster";

/** 文件名去掉 Windows/手机系统不允许的字符 */
function safeName(title: string): string {
  return (
    title
      .replace(/[\\/:*?"<>|]/g, " ")
      .trim()
      .slice(0, 60) || "行程长图"
  );
}

const noop = () => () => {};

/** 分享环境：是否本机地址、是否 App 内置浏览器、是否支持系统分享文件 */
function useShareEnvironment() {
  const host = useSyncExternalStore(
    noop,
    () => window.location.host,
    () => "",
  );
  const ua = useSyncExternalStore(
    noop,
    () => navigator.userAgent,
    () => "",
  );
  const shareFiles = useSyncExternalStore(
    noop,
    () => typeof navigator.canShare === "function",
    () => false,
  );
  return {
    host,
    localOnly: /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host),
    inApp: /MicroMessenger|QQ\/|DingTalk|Weibo|AlipayClient/i.test(ua),
    shareFiles,
  };
}

export function ShareDialog({
  open,
  trip,
  request,
  onClose,
}: {
  open: boolean;
  trip: Trip;
  request: TripRequest;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [link, setLink] = useState<string | null>(null);
  const [poster, setPoster] = useState<string | null>(null);
  const [posterFile, setPosterFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const node = dialog.current;
    if (!node) {
      return;
    }
    if (open && !node.open) {
      node.showModal();
    } else if (!open && node.open) {
      node.close();
    }
  }, [open]);

  // 打开时生成链接与海报；行程变化后重新生成
  useEffect(() => {
    if (!open) {
      return;
    }
    let cancelled = false;
    let url: string | null = null;
    void (async () => {
      try {
        const code = await encodeShare(request, trip);
        if (!cancelled) {
          setLink(`${window.location.origin}/share#${code}`);
        }
        const blob = await renderPoster(trip, request);
        url = URL.createObjectURL(blob);
        if (!cancelled) {
          setPoster(url);
          setPosterFile(
            new File([blob], `${safeName(trip.title)}.png`, { type: "image/png" }),
          );
        }
      } catch {
        if (!cancelled) {
          setError("生成失败，请稍后重试");
        }
      }
    })();
    return () => {
      cancelled = true;
      if (url) {
        URL.revokeObjectURL(url);
      }
      setLink(null);
      setPoster(null);
      setPosterFile(null);
      setError(null);
    };
  }, [open, trip, request]);

  const env = useShareEnvironment();
  const canShareFile = Boolean(
    posterFile && env.shareFiles && navigator.canShare?.({ files: [posterFile] }),
  );

  const sharePoster = async () => {
    if (posterFile) {
      await navigator
        .share({ files: [posterFile], title: trip.title })
        .catch(() => undefined);
    }
  };

  const copy = async () => {
    if (!link) {
      return;
    }
    await navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === dialog.current) {
          onClose();
        }
      }}
      aria-labelledby="share-title"
      className="m-auto w-[min(880px,calc(100vw-24px))] rounded-2xl border border-line bg-card p-0 text-ink shadow-float backdrop:bg-ink/40"
    >
      <div className="flex max-h-[min(860px,90dvh)] flex-col">
        <div className="flex items-start justify-between gap-3 border-b border-line-soft px-5 py-4 sm:px-6">
          <div>
            <h2 id="share-title" className="font-display text-xl">
              分享这份手册
            </h2>
            <p className="mt-0.5 text-sm text-ink-soft">
              链接里就是完整行程，打开即可查看，不经过服务器保存。
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="rounded-md p-1.5 text-ink-soft hover:bg-paper-deep"
          >
            <X size={18} />
          </button>
        </div>

        <div className="grid min-h-0 flex-1 gap-6 overflow-y-auto p-5 sm:p-6 md:grid-cols-[1fr_300px]">
          <div className="space-y-6">
            <section>
              <h3 className="flex items-center gap-1.5 text-sm font-medium">
                <Link2 size={15} className="text-pine" aria-hidden />
                只读链接
              </h3>
              <div className="mt-2 flex gap-2">
                <input
                  readOnly
                  aria-label="分享链接"
                  value={link ?? "生成中…"}
                  onFocus={(event) => event.currentTarget.select()}
                  className="h-11 min-w-0 flex-1 truncate rounded-lg border border-line bg-paper px-3 text-sm text-ink-soft"
                />
                <button
                  type="button"
                  disabled={!link}
                  onClick={copy}
                  className="flex h-11 shrink-0 items-center gap-1.5 rounded-lg bg-pine px-4 text-sm font-medium text-white hover:bg-pine-deep disabled:opacity-50"
                >
                  {copied ? (
                    <Check size={15} aria-hidden />
                  ) : (
                    <Copy size={15} aria-hidden />
                  )}
                  {copied ? "已复制" : "复制"}
                </button>
              </div>
              {env.localOnly ? (
                <p className="mt-2 rounded-md bg-amber-soft px-3 py-2 text-xs leading-relaxed text-amber">
                  当前是本机地址（{env.host}
                  ），只有这台电脑能打开。要发给别人，请用部署后的网址或局域网地址访问本站后再分享。
                </p>
              ) : null}
              <p className="mt-2 text-xs leading-relaxed text-ink-faint">
                对方打开后可以浏览完整手册和地图，也可以一键存到自己的行程里继续修改；你之后的改动不会同步到已发出的链接。
              </p>
            </section>
            <section>
              <h3 className="flex items-center gap-1.5 text-sm font-medium">
                <Download size={15} className="text-pine" aria-hidden />
                行程长图
              </h3>
              <p className="mt-1 text-sm text-ink-soft">
                适合发给同伴或发到社交平台，包含每天的时间、地点和人均预算。
              </p>
              {poster ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {canShareFile ? (
                    <button
                      type="button"
                      onClick={sharePoster}
                      className="inline-flex h-11 items-center gap-1.5 rounded-lg bg-pine px-4 text-sm font-medium text-white hover:bg-pine-deep"
                    >
                      <Share size={15} aria-hidden />
                      保存或发送长图
                    </button>
                  ) : null}
                  <a
                    href={poster}
                    download={posterFile?.name ?? "行程长图.png"}
                    className="inline-flex h-11 items-center gap-1.5 rounded-lg border border-line bg-card px-4 text-sm font-medium text-ink hover:border-ink-faint"
                  >
                    <Download size={15} aria-hidden />
                    下载长图
                  </a>
                  <a
                    href={poster}
                    target="_blank"
                    rel="noopener"
                    className="inline-flex h-11 items-center gap-1.5 rounded-lg px-3 text-sm text-ink-soft hover:bg-paper-deep hover:text-ink"
                  >
                    <ExternalLink size={15} aria-hidden />
                    查看原图
                  </a>
                </div>
              ) : null}
              {env.inApp ? (
                <p className="mt-2 text-xs text-amber">
                  当前在 App
                  内置浏览器中，可能无法直接下载：请长按右侧长图保存，或用系统浏览器打开本页。
                </p>
              ) : null}
            </section>
            {error ? (
              <p role="alert" className="text-sm text-danger">
                {error}
              </p>
            ) : null}
          </div>

          <div className="relative overflow-hidden rounded-xl border border-line bg-paper-deep md:max-h-[640px] md:overflow-y-auto">
            {poster ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={poster}
                alt={`${trip.title} 行程长图预览`}
                className="block w-full"
              />
            ) : (
              <div className="flex h-80 items-center justify-center gap-2 text-sm text-ink-faint">
                <Loader2 size={16} className="animate-spin" aria-hidden />
                正在绘制长图…
              </div>
            )}
          </div>
        </div>
      </div>
    </dialog>
  );
}
