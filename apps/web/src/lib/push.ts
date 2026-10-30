import { fromB64 } from "./b64";

export type PushState = "unsupported" | "needs-install" | "denied" | "default" | "granted";

const isIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isStandalone = () => matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

export function pushState(): PushState {
  if (!("serviceWorker" in navigator)) return "unsupported";
  // iOS only exposes Web Push to sites added to the Home Screen.
  if (!("PushManager" in window)) return isIos() && !isStandalone() ? "needs-install" : "unsupported";
  return Notification.permission as PushState;
}

export async function registerSw() {
  if (!("serviceWorker" in navigator)) return null;
  return navigator.serviceWorker.register("/sw.js", { scope: "/" });
}

/** Must run from a tap: Safari refuses permission prompts that aren't user-initiated. */
export async function subscribePush(vapidPublicKey: string): Promise<string> {
  const reg = (await registerSw())!;
  await navigator.serviceWorker.ready;
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("Izin notifikasi tidak diberikan");
  const existing = await reg.pushManager.getSubscription();
  const sub = existing ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: fromB64(vapidPublicKey) }));
  return sub.endpoint;
}

export { isIos, isStandalone };
