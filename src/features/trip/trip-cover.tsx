"use client";

import { CalendarDays, Footprints, Users } from "lucide-react";
import Image from "next/image";
import { destinationFor } from "@/lib/destinations";
import { PACE_TEXT, TRAVELER_TEXT } from "@/lib/format";
import type { Trip, TripRequest } from "@/lib/schema";
import { addDays, formatDateLabel } from "@/lib/time";

export function TripCover({ trip, request }: { trip: Trip; request: TripRequest }) {
  const destination = destinationFor(request.city);
  const firstPhoto = trip.days
    .flatMap((day) => day.stops)
    .find((stop) => stop.kind === "sight" && stop.place.photos[0]);
  const photo = destination?.photo ?? firstPhoto?.place.photos[0] ?? null;
  const credit = destination
    ? `摄影 ${destination.credit.author} · ${destination.credit.license}`
    : firstPhoto
      ? `${firstPhoto.place.name} · 图片来自高德地图`
      : null;
  const end = addDays(request.startDate, request.days - 1);

  return (
    <section className="relative overflow-hidden rounded-3xl bg-ink text-paper">
      {photo ? (
        <>
          <Image
            src={photo}
            alt=""
            fill
            priority
            sizes="(min-width: 1280px) 1216px, 100vw"
            className="object-cover"
            unoptimized={!destination}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/35 to-black/10" />
        </>
      ) : (
        <div className="absolute inset-0 bg-pine-deep paper-grain" />
      )}
      <div className="relative flex min-h-[380px] flex-col justify-end p-6 sm:min-h-[460px] sm:p-12">
        <p className="font-display text-lg text-white/80">{request.city}</p>
        <h1 className="mt-2 max-w-4xl font-display text-[clamp(2rem,5vw,3.75rem)] leading-[1.15] text-white">
          {trip.title}
        </h1>
        {trip.subtitle ? (
          <p className="mt-3 max-w-2xl text-[17px] text-white/85">{trip.subtitle}</p>
        ) : null}
        <div className="mt-7 flex flex-wrap gap-x-6 gap-y-2 text-sm text-white/85">
          <span className="flex items-center gap-1.5">
            <CalendarDays size={16} aria-hidden />
            {formatDateLabel(request.startDate)}
            {request.days > 1 ? ` — ${formatDateLabel(end)}` : ""} · {request.days} 天
          </span>
          <span className="flex items-center gap-1.5">
            <Users size={16} aria-hidden />
            {request.travelers} 人 · {TRAVELER_TEXT[request.travelerType]}
          </span>
          <span className="flex items-center gap-1.5">
            <Footprints size={16} aria-hidden />
            {PACE_TEXT[request.pace]}
          </span>
        </div>
      </div>
      {credit ? (
        <p className="absolute right-4 top-3 text-[11px] text-white/60">{credit}</p>
      ) : null}
    </section>
  );
}
