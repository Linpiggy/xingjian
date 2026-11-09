/**
 * 分享链接编码：行程压缩后放进 URL 的 # 片段。
 * # 之后的内容不会发送到服务器，因此分享不需要后端存储，服务端也看不到行程内容。
 * 解码时把链接视为不可信输入：Zod 全量校验，图片只保留高德域名。
 */
import { simplifyPath } from "./geo";
import {
  tripRequestSchema,
  tripSchema,
  type Place,
  type Trip,
  type TripRequest,
} from "./schema";

const VERSION = "1";

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array {
  const base64 = text.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function transform(
  data: Uint8Array,
  stream: CompressionStream | DecompressionStream,
): Promise<Uint8Array> {
  const output = new Blob([data as BlobPart]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(output).arrayBuffer());
}

const round = (value: number) => Math.round(value * 1e5) / 1e5;

function compactPlace(place: Place): Place {
  return {
    ...place,
    location: [round(place.location[0]), round(place.location[1])],
    photos: place.photos.slice(0, 1),
  };
}

/** 去掉候选地点、简化路线折线，体积通常压缩到原来的十分之一以下 */
export function compactTrip(trip: Trip): Trip {
  return {
    ...trip,
    candidates: [],
    hotel: trip.hotel ? { ...trip.hotel, place: compactPlace(trip.hotel.place) } : null,
    days: trip.days.map((day) => {
      const leg = (item: Trip["days"][number]["legs"][number]) => ({
        ...item,
        path: simplifyPath(item.path).map(
          ([lng, lat]) => [round(lng), round(lat)] as [number, number],
        ),
      });
      return {
        ...day,
        stops: day.stops.map((stop) => ({ ...stop, place: compactPlace(stop.place) })),
        legs: day.legs.map(leg),
        startLeg: day.startLeg ? leg(day.startLeg) : null,
        endLeg: day.endLeg ? leg(day.endLeg) : null,
      };
    }),
  };
}

export async function encodeShare(request: TripRequest, trip: Trip): Promise<string> {
  const json = JSON.stringify({ request, trip: compactTrip(trip) });
  const compressed = await transform(
    new TextEncoder().encode(json),
    new CompressionStream("deflate-raw"),
  );
  return `${VERSION}.${toBase64Url(compressed)}`;
}

function safePhoto(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === "https:" && /(^|\.)(autonavi|amap)\.com$/.test(parsed.hostname)
    );
  } catch {
    return false;
  }
}

function sanitizePlace(place: Place): Place {
  return { ...place, photos: place.photos.filter(safePhoto) };
}

export async function decodeShare(
  payload: string,
): Promise<{ request: TripRequest; trip: Trip }> {
  const [version, body] = payload.split(".", 2);
  if (version !== VERSION || !body || body.length > 400_000) {
    throw new Error("分享链接无效或已损坏");
  }
  const json = new TextDecoder().decode(
    await transform(fromBase64Url(body), new DecompressionStream("deflate-raw")),
  );
  const data = JSON.parse(json) as { request: unknown; trip: unknown };
  const request = tripRequestSchema.parse(data.request);
  const trip = tripSchema.parse(data.trip);
  return {
    request,
    trip: {
      ...trip,
      hotel: trip.hotel
        ? { ...trip.hotel, place: sanitizePlace(trip.hotel.place) }
        : null,
      days: trip.days.map((day) => ({
        ...day,
        stops: day.stops.map((stop) => ({ ...stop, place: sanitizePlace(stop.place) })),
      })),
    },
  };
}
