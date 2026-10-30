import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";
export default function ManualPage() {
  redirect("/plan?mode=manual");
}
