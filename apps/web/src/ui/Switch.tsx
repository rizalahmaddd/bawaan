import type { InputHTMLAttributes } from "react";
import { cx } from "./cx";

/**
 * Native `<input type=checkbox switch>`: Safari 17.4+ draws the real iOS switch and plays its haptic.
 * Other browsers get a CSS look-alike (see .ios-switch in ui.css).
 */
export function Switch({ className, ...rest }: Omit<InputHTMLAttributes<HTMLInputElement>, "type">) {
  return <input type="checkbox" role="switch" {...{ switch: "" }} className={cx("ios-switch", className)} {...rest} />;
}
