"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Dialog } from "./dialog";
import { Button } from "../button/button";
import styles from "./confirm-dialog.module.css";

type Prompt = { message: string; resolve: (confirmed: boolean) => void };
export function useConfirmDialog() {
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const active = useRef<Prompt | null>(null);
  useEffect(() => () => active.current?.resolve(false), []);
  const confirm = useCallback(
    (message: string) =>
      new Promise<boolean>((resolve) => {
        active.current?.resolve(false);
        const next = { message, resolve };
        active.current = next;
        setPrompt(next);
      }),
    [],
  );
  function finish(value: boolean) {
    active.current?.resolve(value);
    active.current = null;
    setPrompt(null);
  }
  const confirmation = prompt ? (
    <Dialog className={styles.dialog} aria-label="确认操作" onClose={() => finish(false)}>
      <h2>确认操作</h2>
      <p>{prompt.message}</p>
      <div className={styles.actions}>
        <Button onClick={() => finish(false)}>暂不继续</Button>
        <Button variant="primary" onClick={() => finish(true)}>
          继续操作
        </Button>
      </div>
    </Dialog>
  ) : null;
  return { confirm, confirmation };
}
