"use client";

// Adapted from Arc Library (MIT); see ../LICENSE. Native hidden avoids height/blur animation.
import { useState } from "react";
import type { ReactNode } from "react";
import * as AccordionPrimitive from "@radix-ui/react-accordion";
import { ChevronDown } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { motionTokens } from "../motion-tokens";
import styles from "./accordion.module.css";

export interface AccordionItem {
  title: string;
  content: ReactNode;
}
export interface AccordionProps {
  items: AccordionItem[];
  defaultOpen?: number;
  className?: string;
}
export function Accordion({ items, defaultOpen = -1, className }: AccordionProps) {
  const initial =
    defaultOpen >= 0 && defaultOpen < items.length ? String(defaultOpen) : "";
  const [value, setValue] = useState(initial);
  const reduced = useReducedMotion();
  return (
    <AccordionPrimitive.Root
      className={["arc-component", styles.accordion, className].filter(Boolean).join(" ")}
      type="single"
      collapsible
      value={value}
      onValueChange={setValue}
    >
      {items.map((item, index) => {
        const open = value === String(index);
        return (
          <AccordionPrimitive.Item
            className={styles.item}
            value={String(index)}
            key={`${item.title}-${index}`}
          >
            <AccordionPrimitive.Header className={styles.header}>
              <AccordionPrimitive.Trigger className={styles.trigger}>
                <span>{item.title}</span>
                <motion.span
                  className={styles.icon}
                  initial={false}
                  animate={{ rotate: open ? 180 : 0 }}
                  transition={reduced ? { duration: 0 } : motionTokens.spring.snappy}
                >
                  <ChevronDown size={17} aria-hidden="true" />
                </motion.span>
              </AccordionPrimitive.Trigger>
            </AccordionPrimitive.Header>
            <AccordionPrimitive.Content
              forceMount
              hidden={!open}
              className={styles.panel}
            >
              <div className={styles.panelInner}>{item.content}</div>
            </AccordionPrimitive.Content>
          </AccordionPrimitive.Item>
        );
      })}
    </AccordionPrimitive.Root>
  );
}
