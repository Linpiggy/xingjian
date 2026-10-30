"use client";
import { useState } from "react";
import { socialPhotoLabels } from "@/domain/social-photo";
import { placePhotoKey, usePhotoStore } from "./photo-store";
import "./social-photo.css";

export function PlacePhoto({
  city,
  placeId,
  name,
}: {
  city: string;
  placeId: string;
  name: string;
}) {
  const photo = usePhotoStore((state) => state.photos[placePhotoKey(city, placeId)]);
  const [failed, setFailed] = useState<string | null>(null);
  if (!photo) {
    return null;
  }
  return (
    <figure className="trip-place-photo">
      {failed === photo.blobUrl ? (
        <p>参考图无法显示</p>
      ) : (
        // Deliberately a session Blob, never a model URL or an arbitrary server proxy.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={photo.blobUrl}
          draggable={false}
          alt={`${name}的用户关联参考图，非平台核实实景`}
          onError={() => setFailed(photo.blobUrl)}
        />
      )}
      <figcaption>
        <a href={photo.source.sourceUrl} target="_blank" rel="noreferrer noopener">
          {socialPhotoLabels[photo.source.platform]}来源
        </a>
        <span>{photo.credit}</span>
      </figcaption>
    </figure>
  );
}
