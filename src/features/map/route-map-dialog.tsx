import { useLayoutEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

export function RouteMapDialog({
  date,
  fixture,
  onClose,
  children,
}: {
  date: string;
  fixture: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!dialog) {
      return;
    }
    const trigger = document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.showModal();
    dialog.querySelector<HTMLElement>("h2")?.focus();
    return () => {
      dialog.close();
      document.body.style.overflow = overflow;
      if (trigger instanceof HTMLElement && trigger.isConnected) {
        trigger.focus({ preventScroll: true });
      }
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className="route-map-dialog"
      aria-labelledby="route-map-dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Tab" || event.altKey || event.ctrlKey || event.metaKey) {
          return;
        }
        const controls = [
          ...event.currentTarget.querySelectorAll<HTMLElement>(
            'button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]',
          ),
        ].filter((element) => element.getClientRects().length > 0);
        const first = controls[0];
        const last = controls.at(-1);
        const outside = !controls.includes(document.activeElement as HTMLElement);
        if (event.shiftKey && (document.activeElement === first || outside)) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && (document.activeElement === last || outside)) {
          event.preventDefault();
          first?.focus();
        }
      }}
    >
      <header className="route-map-dialog-header">
        <div>
          <span>{date} · 全天路线</span>
          <h2 id="route-map-dialog-title" tabIndex={-1}>
            把这一天，看得更清楚
          </h2>
          {fixture && (
            <small className="route-map-source-note">
              离线测试 fixture · 非真实查询路线
            </small>
          )}
        </div>
        <button
          type="button"
          className="button"
          aria-label="收起放大地图"
          onClick={onClose}
        >
          <X size={20} aria-hidden="true" />
        </button>
      </header>
      {children}
    </dialog>
  );
}
