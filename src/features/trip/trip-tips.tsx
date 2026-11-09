"use client";

import type { Citation, Trip } from "@/lib/schema";

/** 贴士、行李清单与信息来源（手册与分享页共用） */
export function TripTips({
  trip,
  citations,
}: {
  trip: Trip;
  citations: Map<string, Citation>;
}) {
  return (
    <>
      <h2 className="border-b border-ink pb-4 font-display text-[28px] text-ink">
        贴士与准备
      </h2>
      <div className="mt-6 grid gap-8 md:grid-cols-[1.4fr_1fr]">
        <ol className="space-y-3">
          {trip.tips.map((tip, index) => (
            <li key={index} className="flex gap-3 text-[15px] leading-relaxed text-ink">
              <span className="font-display text-pine tabular">{index + 1}.</span>
              <span>
                {tip.text}
                {tip.citations.map((cid) =>
                  citations.has(cid) ? (
                    <a
                      key={cid}
                      href={`#cite-${cid}`}
                      className="ml-1 text-xs text-pine hover:underline"
                    >
                      [{citations.get(cid)!.title}]
                    </a>
                  ) : null,
                )}
              </span>
            </li>
          ))}
        </ol>
        {trip.packing.length ? (
          <div>
            <h3 className="text-sm font-medium text-ink">行李清单</h3>
            <ul className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2">
              {trip.packing.map((item) => (
                <li key={item} className="flex items-center gap-2 text-sm text-ink-soft">
                  <span
                    className="size-3.5 rounded-sm border border-ink-faint"
                    aria-hidden
                  />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>

      <h3 className="mt-14 font-display text-xl text-ink">信息来源</h3>
      <p className="mt-2 text-sm text-ink-soft">
        手册中的地点、评分、营业时间、实景图、路线与天气均来自高德开放平台的实时查询；玩法与注意事项引用自行间旅行知识库；门票、餐费与住宿为
        AI 估算。生成于{" "}
        {new Date(trip.generatedAt).toLocaleString("zh-CN", { hour12: false })}
        ，出行前请以景区官方公告为准。
      </p>
      {trip.citations.length ? (
        <ol className="mt-5 space-y-3">
          {trip.citations.map((citation) => (
            <li
              key={citation.id}
              id={`cite-${citation.id}`}
              className="scroll-mt-24 rounded-lg border border-line-soft bg-card px-4 py-3 target:border-pine"
            >
              <p className="text-sm font-medium text-ink">
                {citation.title}
                <span className="ml-2 text-xs font-normal text-ink-faint">
                  {citation.source}
                </span>
              </p>
              <p className="mt-1 text-sm leading-relaxed text-ink-soft">
                {citation.excerpt}
              </p>
            </li>
          ))}
        </ol>
      ) : null}
    </>
  );
}
