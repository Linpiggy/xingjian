"use client";

// Adapted from Arc Library (MIT); see ../LICENSE. No panel/height animation.
import * as TabsPrimitive from "@radix-ui/react-tabs";
import {
  createContext,
  useCallback,
  useContext,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { ComponentPropsWithoutRef } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { LayoutGroup, motion, useReducedMotion } from "motion/react";
import { motionTokens } from "../motion-tokens";
import styles from "./tabs.module.css";

type RootProps = ComponentPropsWithoutRef<typeof TabsPrimitive.Root>;
const TabsContext = createContext({ active: "", pointer: false });

export function Tabs({
  value,
  defaultValue,
  onValueChange,
  className,
  onPointerDownCapture,
  onKeyDownCapture,
  ...props
}: RootProps) {
  const [internal, setInternal] = useState(defaultValue ?? "");
  const [pointer, setPointer] = useState(false);
  const active = value ?? internal;
  const layoutId = useId();
  return (
    <TabsContext.Provider value={{ active, pointer }}>
      <LayoutGroup id={layoutId}>
        <TabsPrimitive.Root
          {...props}
          className={["arc-component", styles.root, className].filter(Boolean).join(" ")}
          value={active}
          onValueChange={(next) => {
            if (value === undefined) {
              setInternal(next);
            }
            onValueChange?.(next);
          }}
          onPointerDownCapture={(event) => {
            setPointer(true);
            onPointerDownCapture?.(event);
          }}
          onKeyDownCapture={(event) => {
            setPointer(false);
            onKeyDownCapture?.(event);
          }}
        />
      </LayoutGroup>
    </TabsContext.Provider>
  );
}

export function TabsList({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof TabsPrimitive.List>) {
  const { active } = useContext(TabsContext);
  const shell = useRef<HTMLDivElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ overflow: false, left: false, right: false });
  const update = useCallback(() => {
    const frame = shell.current;
    const scroll = viewport.current;
    if (!frame || !scroll) {
      return;
    }
    const max = Math.max(0, scroll.scrollWidth - scroll.clientWidth);
    const next = {
      overflow: scroll.scrollWidth > frame.clientWidth + 1,
      left: scroll.scrollLeft > 1,
      right: scroll.scrollLeft < max - 1,
    };
    setEdges((previous) =>
      previous.overflow === next.overflow &&
      previous.left === next.left &&
      previous.right === next.right
        ? previous
        : next,
    );
  }, []);
  const reveal = useCallback((tab: HTMLElement | null) => {
    const scroll = viewport.current;
    if (!scroll || !tab) {
      return;
    }
    const frame = scroll.getBoundingClientRect();
    const item = tab.getBoundingClientRect();
    const padding = getComputedStyle(scroll);
    const left = frame.left + parseFloat(padding.paddingLeft);
    const right = frame.right - parseFloat(padding.paddingRight);
    const delta =
      item.left < left ? item.left - left : item.right > right ? item.right - right : 0;
    if (delta) {
      scroll.scrollBy({ left: delta, behavior: "instant" });
    }
  }, []);
  useLayoutEffect(() => {
    const frame = shell.current;
    const scroll = viewport.current;
    const content = list.current;
    if (!frame || !scroll || !content) {
      return;
    }
    const observer = new ResizeObserver(() => {
      update();
      reveal(
        content.querySelector<HTMLElement>('[role="tab"]:focus') ??
          content.querySelector<HTMLElement>('[role="tab"][data-state="active"]'),
      );
    });
    observer.observe(frame);
    observer.observe(scroll);
    observer.observe(content);
    scroll.addEventListener("scroll", update, { passive: true });
    update();
    return () => {
      observer.disconnect();
      scroll.removeEventListener("scroll", update);
    };
  }, [update, reveal]);
  useLayoutEffect(() => {
    reveal(
      list.current?.querySelector<HTMLElement>('[role="tab"][data-state="active"]') ??
        null,
    );
  }, [active, edges.overflow, reveal]);
  function scrollTabs(direction: number) {
    viewport.current?.scrollBy({
      left: direction * viewport.current.clientWidth * 0.75,
      behavior: "instant",
    });
  }
  return (
    <div
      ref={shell}
      className={styles.listShell}
      data-left={edges.left}
      data-right={edges.right}
    >
      {edges.overflow && (
        <button
          type="button"
          className={styles.scrollButton}
          aria-label="查看前面的日期"
          disabled={!edges.left}
          onClick={() => scrollTabs(-1)}
        >
          <ChevronLeft size={18} aria-hidden="true" />
        </button>
      )}
      <motion.div
        ref={viewport}
        layoutScroll
        className={styles.viewport}
        onFocusCapture={(event) => {
          if (
            event.target instanceof HTMLElement &&
            event.target.getAttribute("role") === "tab"
          ) {
            reveal(event.target);
          }
        }}
      >
        <TabsPrimitive.List
          {...props}
          ref={list}
          className={[styles.list, className].filter(Boolean).join(" ")}
        />
      </motion.div>
      {edges.overflow && (
        <button
          type="button"
          className={styles.scrollButton}
          aria-label="查看后面的日期"
          disabled={!edges.right}
          onClick={() => scrollTabs(1)}
        >
          <ChevronRight size={18} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

export function TabsTrigger({
  className,
  children,
  value,
  ...props
}: ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>) {
  const { active, pointer } = useContext(TabsContext);
  const reduced = useReducedMotion();
  return (
    <TabsPrimitive.Trigger
      {...props}
      value={value}
      data-value={value}
      className={[styles.trigger, className].filter(Boolean).join(" ")}
    >
      {active === value && (
        <motion.span
          className={styles.selection}
          layoutId="selection"
          layoutDependency={active}
          transition={reduced || !pointer ? { duration: 0 } : motionTokens.spring.snappy}
          aria-hidden="true"
        />
      )}
      <span className={styles.triggerLabel}>{children}</span>
    </TabsPrimitive.Trigger>
  );
}

export function TabsContent({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      {...props}
      forceMount
      className={[styles.content, className].filter(Boolean).join(" ")}
    />
  );
}
