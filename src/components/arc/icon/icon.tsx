import type { LucideIcon, LucideProps } from "lucide-react";

export function ArcIcon({
  icon: Icon,
  size = "md",
  style,
  ...props
}: Omit<LucideProps, "size"> & { icon: LucideIcon; size?: "sm" | "md" | "lg" }) {
  return (
    <Icon
      {...props}
      style={{
        ...style,
        width: `var(--icon-${size})`,
        height: `var(--icon-${size})`,
        flexShrink: 0,
      }}
    />
  );
}
