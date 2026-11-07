import type { Metadata } from "next";
import { TripPage } from "@/features/trip/trip-page";

export const metadata: Metadata = {
  title: "旅行手册 · 行间",
};

export default async function PlanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <TripPage id={id} />;
}
