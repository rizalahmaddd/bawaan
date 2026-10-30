import { X } from "lucide-react";
import { Dialog } from "radix-ui";
import { useRef, useState, type PointerEvent, type ReactNode } from "react";
import { REGULAR, useMediaQuery } from "../lib/useMediaQuery";
import { cx } from "./cx";

type Detent = "medium" | "large";

const detentHeight: Record<Detent, string> = {
  medium: "min(60dvh, 560px)",
  large: "calc(100dvh - var(--safe-top) - 10px)",
};

/**
 * Bottom sheet with medium/large detents and drag-to-dismiss on phones;
 * a centered form sheet from regular width up.
 */
export function Sheet({ open, onOpenChange, title, detents = ["medium", "large"], trailing, children }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  detents?: Detent[];
  trailing?: ReactNode;
  children: ReactNode;
}) {
  const regular = useMediaQuery(REGULAR);
  const [detent, setDetent] = useState<Detent>(detents[0] ?? "large");
  const [drag, setDrag] = useState(0);
  const start = useRef<number | null>(null);

  const onPointerDown = (e: PointerEvent) => {
    // Capturing the pointer on a button swallows its click in WebKit.
    if (regular || (e.target as HTMLElement).closest("button")) return;
    start.current = e.clientY;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent) => {
    if (start.current === null) return;
    const dy = e.clientY - start.current;
    // Rubber-band when pulling up past the tallest detent.
    setDrag(dy < 0 ? -Math.sqrt(-dy) * 3 : dy);
  };
  const onPointerUp = (e: PointerEvent) => {
    if (start.current === null) return;
    const dy = e.clientY - start.current;
    start.current = null;
    setDrag(0);
    if (dy < -60 && detents.includes("large")) setDetent("large");
    else if (dy > 140) {
      if (detent === "large" && detents.includes("medium")) setDetent("medium");
      else onOpenChange(false);
    }
  };

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (o) setDetent(detents[0] ?? "large");
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="sheet-overlay fixed inset-0 z-50 bg-[var(--scrim)]" />
        <Dialog.Content
          aria-describedby={undefined}
          className={cx(
            "sheet-panel fixed z-50 flex flex-col overflow-hidden shadow-2xl outline-none squircle",
            regular
              ? "left-1/2 top-1/2 max-h-[85dvh] w-[min(560px,calc(100%-48px))] -translate-x-1/2 -translate-y-1/2 rounded-[var(--radius-sheet)] bg-grouped"
              : "inset-x-0 bottom-0 rounded-t-[var(--radius-sheet)] bg-grouped",
          )}
          style={
            regular
              ? undefined
              : {
                  height: detentHeight[detent],
                  transform: drag ? `translateY(${drag}px)` : undefined,
                  transition: drag ? "none" : "height 420ms var(--ease-spring), transform 300ms var(--ease-out)",
                }
          }
        >
          <div onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} className="shrink-0 touch-none select-none">
            {!regular && <div aria-hidden className="mx-auto mt-2 h-[5px] w-9 rounded-full bg-label-3" />}
            <div className="flex items-center gap-2 px-4 py-2.5">
              <Dialog.Close className="glass inline-flex size-9 items-center justify-center rounded-full text-label-2" aria-label="Tutup">
                <X className="size-[18px]" strokeWidth={2.5} />
              </Dialog.Close>
              <Dialog.Title className="flex-1 truncate text-center text-headline">{title}</Dialog.Title>
              <div className="flex min-w-9 justify-end">{trailing}</div>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-[max(var(--safe-bottom),16px)] pt-2">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
