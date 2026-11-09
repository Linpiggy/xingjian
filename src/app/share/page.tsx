import type { Metadata } from "next";
import { SharedTrip } from "@/features/share/shared-trip";

export const metadata: Metadata = {
  title: "分享的旅行手册 · 行间",
};

export default function SharePage() {
  return <SharedTrip />;
}
