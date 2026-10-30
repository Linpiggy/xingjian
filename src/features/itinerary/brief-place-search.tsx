"use client";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Search, Plus } from "lucide-react";
import { placesResponseSchema } from "@/lib/contracts";
import { requestJson } from "@/lib/client-api";
import { ArcIcon } from "@/components/arc/icon/icon";
import { Input } from "@/components/arc/input/input";
import { Button } from "@/components/arc/button/button";

export function BriefPlaceSearch({
  city,
  names,
  pending,
  onAdd,
}: {
  city: string;
  names: string[];
  pending: boolean;
  onAdd: (name: string) => void;
}) {
  const [keyword, setKeyword] = useState("");
  const [error, setError] = useState("");
  const search = useMutation({
    mutationFn: (input: { city: string; keyword: string }) =>
      requestJson(`/api/places?${new URLSearchParams(input)}`, placesResponseSchema),
    retry: false,
    gcTime: 0,
  });
  const results =
    search.variables?.city === city.trim()
      ? (search.data?.places
          .filter((place) => place.source.kind !== "user")
          .slice(0, 8) ?? [])
      : [];
  const normalize = (value: string) => value.normalize("NFKC").trim().toLowerCase();
  return (
    <details className="brief-place-search">
      <summary>
        <ArcIcon icon={Search} size="sm" aria-hidden="true" />
        搜索并补充必去地点
      </summary>
      <div className="brief-place-search-row">
        <label>
          搜索必去地点
          <Input
            value={keyword}
            maxLength={80}
            disabled={pending}
            onChange={(event) => setKeyword(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                if (city.trim() && keyword.trim() && !search.isPending) {
                  setError("");
                  search.mutate({ city: city.trim(), keyword: keyword.trim() });
                }
              }
            }}
          />
        </label>
        <Button
          type="button"

          disabled={pending || search.isPending}
          onClick={() => {
            if (!city.trim() || !keyword.trim()) {
              setError("请先填写目的地与地点名称。");
              return;
            }
            setError("");
            search.mutate({ city: city.trim(), keyword: keyword.trim() });
          }}
        >
          <ArcIcon icon={Search} size="md" aria-hidden="true" />
          {search.isPending ? "搜索中…" : "查找地点"}
        </Button>
      </div>
      {(error || search.error) && (
        <p className="trip-error" role="alert">
          {error || search.error?.message}
        </p>
      )}
      {search.isSuccess && search.variables?.city === city.trim() && !results.length && (
        <p>没有匹配地点，请换用完整名称。</p>
      )}
      <ul>
        {results.map((place) => {
          const added = names.some((name) => normalize(name) === normalize(place.name));
          return (
            <li key={place.id}>
              <div>
                <strong>{place.name}</strong>
                <p>{place.address ?? "地址待核实"}</p>
              </div>
              <Button
                type="button"

                aria-label={`将${place.name}加入必去`}
                disabled={pending || added || names.length >= 30}
                onClick={() => onAdd(place.name)}
              >
                <ArcIcon icon={Plus} size="sm" aria-hidden="true" />
                {added ? "已加入" : "加入必去"}
              </Button>
            </li>
          );
        })}
      </ul>
      {results.length > 0 && (
        <p className="small muted">生成时重新核对地点；同名分店请使用完整名称。</p>
      )}
    </details>
  );
}
