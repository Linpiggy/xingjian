"use client";

import { forwardRef, useCallback, useLayoutEffect, useRef } from "react";
import type { DialogHTMLAttributes, RefObject } from "react";

const modalStack: HTMLDialogElement[] = [];
let bodyOverflow = "";
let bodyPadding = "";
export interface DialogProps extends Omit<
  DialogHTMLAttributes<HTMLDialogElement>,
  "open"
> {
  open?: boolean;
  skipRestoreRef?: RefObject<boolean>;
}

// Native top-layer modal, shared by Arc-styled and legacy content. No Radix portal
// replacement: preserve existing title measurements, form semantics and SDK hosts.
export const Dialog = forwardRef<HTMLDialogElement, DialogProps>(function Dialog(
  {
    open = true,
    skipRestoreRef,
    onClose,
    onKeyDown,
    onClick,
    children,
    className,
    ...props
  },
  forwarded,
) {
  const ref = useRef<HTMLDialogElement | null>(null);
  const cleaning = useRef(false);
  const setRef = useCallback(
    (node: HTMLDialogElement | null) => {
      ref.current = node;
      if (typeof forwarded === "function") {
        forwarded(node);
      } else if (forwarded) {
        forwarded.current = node;
      }
    },
    [forwarded],
  );
  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!dialog || !open) {
      return;
    }
    cleaning.current = false;
    const trigger = document.activeElement;
    const canRestoreFocus = () => !skipRestoreRef?.current;
    if (modalStack.length === 0) {
      bodyOverflow = document.body.style.overflow;
      bodyPadding = document.body.style.paddingRight;
      const scrollbar = innerWidth - document.documentElement.clientWidth;
      if (scrollbar > 0) {
        document.body.style.paddingRight = `${scrollbar}px`;
      }
      document.body.style.overflow = "hidden";
    }
    modalStack.push(dialog);
    if (!dialog.open) {
      dialog.showModal();
    }
    const heading = dialog.querySelector<HTMLElement>("h2");
    if (heading) {
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
    }
    return () => {
      cleaning.current = true;
      const index = modalStack.indexOf(dialog);
      if (index >= 0) {
        modalStack.splice(index, 1);
      }
      if (dialog.open) {
        dialog.close();
      }
      if (modalStack.length === 0) {
        document.body.style.overflow = bodyOverflow;
        document.body.style.paddingRight = bodyPadding;
      }
      if (canRestoreFocus() && trigger instanceof HTMLElement && trigger.isConnected) {
        const top = modalStack.at(-1);
        if (!top || top.contains(trigger)) {
          trigger.focus({ preventScroll: true });
        }
      }
    };
  }, [open, skipRestoreRef]);
  return (
    <dialog
      {...props}
      className={["arc-component", className].filter(Boolean).join(" ")}
      ref={setRef}
      onClose={(event) => {
        if (!cleaning.current && !event.currentTarget.open) {
          onClose?.(event);
        }
      }}
      onKeyDown={(event) => {
        if (modalStack.at(-1) !== event.currentTarget) {
          return;
        }
        onKeyDown?.(event);
        if (
          event.defaultPrevented ||
          event.key !== "Tab" ||
          event.ctrlKey ||
          event.metaKey ||
          event.altKey
        ) {
          return;
        }
        event.stopPropagation();
        const dialog = event.currentTarget;
        const controls = Array.from(
          dialog.querySelectorAll<HTMLElement>(
            'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]',
          ),
        ).filter(
          (element) =>
            element.closest("dialog") === dialog &&
            element.getClientRects().length > 0 &&
            getComputedStyle(element).visibility !== "hidden",
        );
        const first = controls[0];
        const last = controls.at(-1);
        const outside = !controls.some((element) => element === document.activeElement);
        if (!first || !last) {
          event.preventDefault();
        } else if (event.shiftKey && (document.activeElement === first || outside)) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && (document.activeElement === last || outside)) {
          event.preventDefault();
          first.focus();
        }
      }}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented || event.target !== event.currentTarget) {
          return;
        }
        const rect = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < rect.left ||
          event.clientX > rect.right ||
          event.clientY < rect.top ||
          event.clientY > rect.bottom
        ) {
          event.currentTarget.close();
        }
      }}
    >
      {children}
    </dialog>
  );
});
