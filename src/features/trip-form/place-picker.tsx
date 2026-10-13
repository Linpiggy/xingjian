"use client";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { MapPin, Search, Sparkles, X } from "lucide-react";
import type { PlaceCandidate } from "@/domain/models";
import {
  placesResponseSchema,
  recommendationInputSchema,
  recommendationsResponseSchema,
} from "@/lib/contracts";
import { requestJson } from "@/lib/client-api";
import { PointPicker } from "@/features/map/point-picker";

type Interest = "自然风光" | "博物馆" | "城市漫步" | "当地美食";
const allInterests: Interest[] = ["自然风光", "博物馆", "城市漫步", "当地美食"];

export function PlacePicker({
  city,
  dayCount,
  budgetPerPersonFen,
  selected,
  onChange,
  error,
  mapKey,
  mapsConfigured,
}: {
  city: string;
  dayCount: number;
  budgetPerPersonFen: number | null;
  selected: PlaceCandidate[];
  onChange: (selected: PlaceCandidate[]) => void;
  error?: string;
  mapKey: string;
  mapsConfigured: boolean;
}) {
  const [keyword, setKeyword] = useState("");
  const [tab, setTab] = useState<"custom" | "ai">("custom");
  const [interests, setInterests] = useState<Interest[]>(["自然风光", "博物馆"]);
  const [mapOpen, setMapOpen] = useState(false);
  const [localError, setLocalError] = useState("");
  const search = useMutation({
    mutationFn: async (query: { city: string; keyword: string }) =>
      requestJson(`/api/places?${new URLSearchParams(query)}`, placesResponseSchema),
  });
  const recommend = useMutation({
    mutationFn: async (input: ReturnType<typeof recommendationInputSchema.parse>) =>
      requestJson("/api/recommendations", recommendationsResponseSchema, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      }),
  });
  const results =
    search.variables?.city === city.trim() ? (search.data?.places ?? []) : [];
  const suggestions =
    recommend.variables?.city === city.trim()
      ? (recommend.data?.recommendations ?? [])
      : [];
  const center =
    selected[0]?.place.location ?? results[0]?.location ?? suggestions[0]?.place.location;

  function find() {
    setLocalError("");
    if (!city.trim() || !keyword.trim()) {
      setLocalError("请先填写城市和搜索关键词。");
      return;
    }
    search.mutate({ city: city.trim(), keyword: keyword.trim() });
  }
  function requestRecommendation() {
    const parsed = recommendationInputSchema.safeParse({
      city,
      dayCount,
      budgetPerPersonFen,
      interests,
    });
    if (!parsed.success) {
      setLocalError("请填写有效城市、天数、预算，并至少选择一项兴趣。");
      return;
    }
    setLocalError("");
    recommend.mutate(parsed.data);
  }
  function add(candidate: PlaceCandidate) {
    if (selected.some((item) => item.place.id === candidate.place.id)) {
      return;
    }
    if (selected.length >= 6) {
      setLocalError("本轮最多六个地点，请先移除一个再添加。");
      return;
    }
    onChange([...selected, candidate]);
    setLocalError("");
  }
  function resultRow(candidate: PlaceCandidate, reason?: string) {
    const added = selected.some((item) => item.place.id === candidate.place.id);
    return (
      <li className="place-result" key={candidate.place.id}>
        <div>
          <strong>{candidate.place.name}</strong>
          <p className="small muted">{candidate.place.address ?? "地址未知"}</p>
          {reason && (
            <p className="recommendation-reason">
              AI 分析：{reason.replace(/^AI\s*分析\s*[:：]\s*/iu, "")}
            </p>
          )}
        </div>
        <button
          type="button"
          className="button"
          aria-label={`添加${candidate.place.name}`}
          disabled={added || selected.length >= 6}
          onClick={() => add(candidate)}
        >
          {added ? "已添加" : "添加"}
        </button>
      </li>
    );
  }

  return (
    <div className="place-picker">
      <div className="place-tabs" role="group" aria-label="地点添加方式">
        <button
          type="button"
          className={`button ${tab === "custom" ? "primary" : ""}`}
          aria-pressed={tab === "custom"}
          onClick={() => {
            setTab("custom");
            setLocalError("");
          }}
        >
          自定义地点
        </button>
        <button
          type="button"
          className={`button ${tab === "ai" ? "primary" : ""}`}
          aria-pressed={tab === "ai"}
          onClick={() => {
            setTab("ai");
            setLocalError("");
          }}
        >
          <Sparkles size={16} aria-hidden="true" />
          AI 智能推荐
        </button>
      </div>
      {tab === "custom" ? (
        <>
          <div className="field">
            <label htmlFor="keywords">搜索地点名称</label>
            <div className="place-search">
              <input
                id="keywords"
                value={keyword}
                maxLength={60}
                onChange={(event) => setKeyword(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    find();
                  }
                }}
                aria-invalid={!!error}
              />
              <button
                type="button"
                className="button"
                onClick={find}
                disabled={search.isPending}
              >
                <Search size={16} aria-hidden="true" />
                {search.isPending ? "搜索中" : "搜索地点"}
              </button>
            </div>
          </div>
          <div className="place-map-action">
            <button
              type="button"
              className="button"
              disabled={!center}
              onClick={() => setMapOpen(true)}
            >
              <MapPin size={16} aria-hidden="true" />
              地图选点
            </button>
            <small>先搜索一个城市内的地点作为地图起点，再点选任意位置。</small>
          </div>
          {search.isPending && <p role="status">正在查询高德地点。</p>}
          {search.isError && (
            <p role="alert" aria-label="地点查询失败" className="error-text">
              {search.error.message}
            </p>
          )}
          {search.isSuccess &&
            search.variables?.city === city.trim() &&
            !results.length && <p role="status">没有找到地点，请更换关键词。</p>}
          <ul className="place-results">
            {results.map((place) =>
              resultRow({
                place,
                selection: {
                  kind: "amap",
                  poiId: place.id,
                  keyword: search.variables!.keyword,
                },
              }),
            )}
          </ul>
        </>
      ) : (
        <>
          <fieldset className="interest-options" disabled={recommend.isPending}>
            <legend>你想怎样旅行</legend>
            {allInterests.map((interest) => (
              <label className="interest-chip" key={interest}>
                <input
                  type="checkbox"
                  checked={interests.includes(interest)}
                  disabled={!interests.includes(interest) && interests.length >= 3}
                  onChange={(event) =>
                    setInterests(
                      event.target.checked
                        ? [...interests, interest]
                        : interests.filter((value) => value !== interest),
                    )
                  }
                />
                {interest}
              </label>
            ))}
          </fieldset>
          <div className="place-map-action">
            <button
              type="button"
              className="button"
              disabled={recommend.isPending}
              onClick={requestRecommendation}
            >
              <Sparkles size={16} aria-hidden="true" />
              {recommend.isPending ? "AI 正在推荐" : "获取 AI 推荐"}
            </button>
            <small>最多三项兴趣；真实模型从高德候选推荐，会消耗接口配额。</small>
          </div>
          {recommend.isPending && (
            <p role="status">先获取真实候选，再由模型选择。不会覆盖已选清单。</p>
          )}
          {recommend.isError && (
            <p role="alert" aria-label="AI推荐失败" className="error-text">
              {recommend.error.message}
            </p>
          )}
          {suggestions.length > 0 && (
            <p className="small muted">
              模型：{recommend.data?.model} / 理由是 AI 分析，开放与价格仍需核实。
            </p>
          )}
          <ul className="place-results">
            {suggestions.map((candidate) => resultRow(candidate, candidate.reason))}
          </ul>
        </>
      )}
      {(selected.some((candidate) => candidate.place.source.kind === "fixture") ||
        results.some((place) => place.source.kind === "fixture") ||
        suggestions.some((candidate) => candidate.place.source.kind === "fixture")) && (
        <p className="notice warning">测试 fixture 候选，不是真实查询或推荐。</p>
      )}
      <div className="selected-places" aria-label="已选地点清单">
        <h3>已选 {selected.length} / 6 个地点</h3>
        {selected.length ? (
          <ol>
            {selected.map((candidate) => (
              <li key={candidate.place.id}>
                <div>
                  <strong>{candidate.place.name}</strong>
                  <small>
                    {candidate.place.source.kind === "fixture"
                      ? "测试 fixture，非实时"
                      : candidate.selection.kind === "user"
                        ? "用户地图选点，未核实"
                        : "高德搜索地点"}
                  </small>
                </div>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`移除${candidate.place.name}`}
                  onClick={() =>
                    onChange(
                      selected.filter((item) => item.place.id !== candidate.place.id),
                    )
                  }
                >
                  <X size={18} />
                </button>
              </li>
            ))}
          </ol>
        ) : (
          <p className="small muted">从搜索结果或 AI 推荐中添加。清单按添加顺序分天。</p>
        )}
      </div>
      {(localError || error) && (
        <p role="alert" aria-label="地点清单提示" className="error-text">
          {localError || error}
        </p>
      )}
      {mapOpen && center && (
        <PointPicker
          center={center}
          mapKey={mapKey}
          configured={mapsConfigured}
          onAdd={add}
          onClose={() => setMapOpen(false)}
        />
      )}
    </div>
  );
}
