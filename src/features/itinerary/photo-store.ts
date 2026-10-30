"use client";
import { create } from "zustand";
import { socialPhotoCandidate, type SocialPhotoCandidate } from "@/domain/social-photo";
export type PlacePhoto = {
  source: SocialPhotoCandidate;
  blobUrl: string;
  credit: string;
};
export const placePhotoKey = (city: string, placeId: string) =>
  JSON.stringify([city.normalize("NFKC").trim().toLowerCase(), placeId]);
export const usePhotoStore = create<{
  photos: Record<string, PlacePhoto>;
  put: (key: string, photo: PlacePhoto) => void;
  remove: (key: string) => void;
}>((set, get) => ({
  photos: {},
  put: (key, photo) => {
    const source = socialPhotoCandidate(
      photo.source.platform,
      photo.source.sourceId,
      photo.source.imageUrl,
    );
    if (
      !source ||
      !photo.blobUrl.startsWith("blob:") ||
      !photo.credit.trim() ||
      photo.credit.length > 100
    ) {
      throw new Error("图片来源、会话内容或署名无效，未关联地点。");
    }
    const previous = get().photos;
    if (!previous[key] && Object.keys(previous).length >= 12) {
      throw new Error("本次会话最多保留 12 张参考图片，请先移除一张。");
    }
    if (previous[key]) {
      URL.revokeObjectURL(previous[key].blobUrl);
    }
    set({ photos: { ...previous, [key]: { ...photo, source } } });
  },
  remove: (key) => {
    const { [key]: removed, ...remaining } = get().photos;
    if (removed) {
      URL.revokeObjectURL(removed.blobUrl);
    }
    set({ photos: remaining });
  },
}));
