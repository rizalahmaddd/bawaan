import { Camera, Loader2, Minus, Plus, Search, X } from "lucide-react";
import { useId, useRef, useState, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { cx } from "./cx";

/** A labelled row inside an inset-grouped section, like the fields in iOS Settings. */
export function Field({ label, hint, error, children, stacked }: { label: string; hint?: ReactNode; error?: string | null; children: (id: string) => ReactNode; stacked?: boolean }) {
  const id = useId();
  return (
    <div className="group/row relative px-4 after:absolute after:inset-x-4 after:bottom-0 after:h-px after:scale-y-50 after:bg-separator last:after:hidden">
      <div className={cx("flex min-h-[var(--tap)] py-2", stacked ? "flex-col gap-1" : "items-center gap-3")}>
        <label htmlFor={id} className={cx("text-body", stacked ? "text-footnote text-label-2" : "w-[38%] shrink-0")}>
          {label}
        </label>
        <div className="min-w-0 flex-1">{children(id)}</div>
      </div>
      {(error || hint) && <p className={cx("pb-2 text-footnote", error ? "text-red-text" : "text-label-2")}>{error || hint}</p>}
    </div>
  );
}

const inputCls = "w-full bg-transparent text-body text-label outline-none placeholder:text-label-3 disabled:opacity-50";

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cx(inputCls, "min-h-8 text-right", className)} {...rest} />;
}

export function TextInput({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cx(inputCls, "min-h-8", className)} {...rest} />;
}

export function TextArea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cx(inputCls, "min-h-20 resize-y py-1", className)} {...rest} />;
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cx(inputCls, "min-h-8 cursor-pointer appearance-none text-right text-label-2", className)} {...rest}>
      {children}
    </select>
  );
}

export function SearchField({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <label className="flex h-10 items-center gap-2 rounded-full bg-fill-3 px-3 text-label-2">
      <Search className="size-[18px] shrink-0" aria-hidden />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="min-w-0 flex-1 bg-transparent text-label outline-none placeholder:text-label-2 [&::-webkit-search-cancel-button]:hidden"
      />
      {value && (
        <button type="button" aria-label="Hapus pencarian" onClick={() => onChange("")} className="flex size-5 items-center justify-center rounded-full bg-label-3 text-elevated">
          <X className="size-3" strokeWidth={3} />
        </button>
      )}
    </label>
  );
}

export function Stepper({ value, onChange, min = 1, max = 99, label }: { value: number; onChange: (v: number) => void; min?: number; max?: number; label: string }) {
  return (
    <div className="inline-flex h-8 items-center rounded-full bg-fill-3" role="group" aria-label={label}>
      <button type="button" aria-label="Kurangi" disabled={value <= min} onClick={() => onChange(value - 1)} className="flex h-8 w-10 items-center justify-center disabled:opacity-30">
        <Minus className="size-4" />
      </button>
      <span className="min-w-6 text-center text-body font-semibold tabular" aria-live="polite">
        {value}
      </span>
      <button type="button" aria-label="Tambah" disabled={value >= max} onClick={() => onChange(value + 1)} className="flex h-8 w-10 items-center justify-center disabled:opacity-30">
        <Plus className="size-4" />
      </button>
    </div>
  );
}

/** Opens the camera on phones, a file picker elsewhere. Upload is the caller's job. */
export function PhotoPicker({ value, onPick, label, busy, className }: { value?: string | null; onPick: (f: File) => void; label: string; busy?: boolean; className?: string }) {
  const ref = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const src = preview ?? value ?? null;
  return (
    <button
      type="button"
      onClick={() => ref.current?.click()}
      className={cx("relative flex aspect-square w-24 shrink-0 items-center justify-center overflow-hidden rounded-[16px] bg-fill-3 text-tint squircle", className)}
      aria-label={label}
    >
      {src ? <img src={src} alt="" className="size-full object-cover" /> : <Camera className="size-7" />}
      {busy && (
        <span className="absolute inset-0 flex items-center justify-center bg-black/30 text-white">
          <Loader2 className="spinner size-6" />
        </span>
      )}
      <input
        ref={ref}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          setPreview(URL.createObjectURL(f));
          onPick(f);
          e.target.value = "";
        }}
      />
    </button>
  );
}
