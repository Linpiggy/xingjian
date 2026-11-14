/**
 * 首页示例手册：两份由 Agent 实际生成的行程，点击时才按需加载（不增加首屏体积），
 * 导入本地后可以像自己的行程一样浏览、手动编辑和让 AI 调整。
 */
"use client";

import { ArrowUpRight, Loader2 } from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { destinationFor } from "@/lib/destinations";
import { tripRequestSchema, tripSchema } from "@/lib/schema";
import { useTrips } from "@/store/trips";

const SAMPLES = [
  {
    key: "hangzhou",
    city: "杭州",
    title: "两天，灵隐听钟，西湖看落日",
    meta: "2 天 · 情侣 · 上海出发，含往返高铁",
    load: () => import("@/data/samples/hangzhou.json"),
  },
  {
    key: "chengdu",
    city: "成都",
    title: "三天，熊猫与慢生活",
    meta: "3 天 · 亲子 · 孩子不吃辣 · 轻松节奏",
    load: () => import("@/data/samples/chengdu.json"),
  },
] as const;

export function SampleTrips() {
  const router = useRouter();
  const importSample = useTrips((state) => state.importSample);
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const open = async (sample: (typeof SAMPLES)[number]) => {
    setLoading(sample.key);
    setError(null);
    try {
      const data = (await sample.load()).default as unknown as {
        request: unknown;
        trip: unknown;
      };
      const id = importSample(
        tripRequestSchema.parse(data.request),
        tripSchema.parse(data.trip),
      );
      router.push(`/plan/${id}`);
    } catch {
      setError("示例加载失败，请刷新后重试");
      setLoading(null);
    }
  };

  return (
    <div>
      <div className="grid gap-4 md:grid-cols-2">
        {SAMPLES.map((sample) => {
          const photo = destinationFor(sample.city)?.photo;
          return (
            <button
              key={sample.key}
              type="button"
              onClick={() => void open(sample)}
              disabled={loading !== null}
              className="group grid grid-cols-[120px_1fr] overflow-hidden rounded-2xl border border-line bg-card text-left transition-colors hover:border-ink-faint disabled:opacity-70 sm:grid-cols-[160px_1fr]"
            >
              <span className="relative block min-h-36 bg-paper-deep">
                {photo ? (
                  <Image src={photo} alt="" fill sizes="160px" className="object-cover" />
                ) : null}
              </span>
              <span className="flex flex-col justify-between gap-4 p-5">
                <span>
                  <span className="text-xs text-ink-faint">示例手册 · {sample.city}</span>
                  <span className="mt-1 block font-display text-xl leading-snug text-ink">
                    {sample.title}
                  </span>
                  <span className="mt-1.5 block text-sm text-ink-soft">
                    {sample.meta}
                  </span>
                </span>
                <span className="flex items-center gap-1 text-sm font-medium text-pine">
                  {loading === sample.key ? (
                    <Loader2 size={15} className="animate-spin" aria-hidden />
                  ) : (
                    <ArrowUpRight
                      size={16}
                      className="transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
                      aria-hidden
                    />
                  )}
                  翻开看看
                </span>
              </span>
            </button>
          );
        })}
      </div>
      {error ? (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
