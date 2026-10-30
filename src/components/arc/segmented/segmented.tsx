"use client";

// Compact Arc-style tabs share Radix semantics with the date navigation.
import * as Tabs from "@radix-ui/react-tabs";
import type { ComponentPropsWithoutRef } from "react";
import styles from "./segmented.module.css";

export function Segmented({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof Tabs.Root>) {
  return (
    <Tabs.Root
      {...props}
      className={["arc-component", className].filter(Boolean).join(" ")}
    />
  );
}
export function SegmentedList({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof Tabs.List>) {
  return (
    <Tabs.List
      {...props}
      className={[styles.list, className].filter(Boolean).join(" ")}
    />
  );
}
export function SegmentedTrigger({
  className,
  children,
  ...props
}: ComponentPropsWithoutRef<typeof Tabs.Trigger>) {
  return (
    <Tabs.Trigger
      {...props}
      className={[styles.trigger, className].filter(Boolean).join(" ")}
    >
      {children}
    </Tabs.Trigger>
  );
}
export function SegmentedContent({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof Tabs.Content>) {
  return (
    <Tabs.Content
      {...props}
      forceMount
      className={[styles.content, className].filter(Boolean).join(" ")}
    />
  );
}
