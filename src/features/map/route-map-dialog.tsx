import type { ReactNode } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/arc/button/button";
import { Dialog } from "@/components/arc/dialog/dialog";

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
  return (
    <Dialog
      className="route-map-dialog"
      aria-labelledby="route-map-dialog-title"
      onClose={onClose}
    >
      <header className="route-map-dialog-header">
        <div>
          <span>{date} · 全天路线</span>
          <h2 id="route-map-dialog-title" tabIndex={-1}>
            全天路线
          </h2>
          {fixture && (
            <small className="route-map-source-note">
              离线测试 fixture · 非真实查询路线
            </small>
          )}
        </div>
        <Button aria-label="收起放大地图" onClick={onClose}>
          <X size={20} aria-hidden="true" />
        </Button>
      </header>
      {children}
    </Dialog>
  );
}
