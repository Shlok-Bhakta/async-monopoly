import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
const isStandalone =
  window.matchMedia("(display-mode: standalone)").matches ||
  (navigator as any).standalone === true;
const pushSupported = "serviceWorker" in navigator && "PushManager" in window;

export function Notifications() {
  const vapidKey = useQuery(api.notifyDb.getVapidPublicKey);
  const subscribePush = useMutation(api.notifyDb.subscribePush);
  const unsubscribePush = useMutation(api.notifyDb.unsubscribePush);

  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [installPrompt, setInstallPrompt] = useState<any>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const reg = await navigator.serviceWorker?.getRegistration();
        const sub = await reg?.pushManager.getSubscription();
        if (!cancelled) setSubscribed(!!sub);
      } catch {
        /* not supported */
      }
    })();
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => {
      cancelled = true;
      window.removeEventListener("beforeinstallprompt", onPrompt);
    };
  }, []);

  async function enable() {
    setError(null);
    setOk(null);
    setBusy(true);
    try {
      if (!pushSupported) throw new Error("Push isn't supported in this browser.");
      if (!vapidKey) throw new Error("Push isn't configured on the server yet.");
      const reg = await navigator.serviceWorker.getRegistration();
      if (!reg) throw new Error("Service worker isn't active here — notifications work on the deployed site.");
      const perm = await Notification.requestPermission();
      if (perm !== "granted") throw new Error("Notification permission was denied.");
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey) as unknown as BufferSource,
      });
      await subscribePush({
        subscription: {
          endpoint: sub.endpoint,
          p256dh: toBase64(sub.getKey("p256dh")!),
          auth: toBase64(sub.getKey("auth")!),
        },
      });
      setSubscribed(true);
      setOk("🔔 On. You'll get pinged when it's your turn.");
    } catch (e: any) {
      setError(e.message ?? "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker?.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await unsubscribePush({ endpoint: sub.endpoint });
        await sub.unsubscribe();
      }
      setSubscribed(false);
      setOk(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function installApp() {
    if (!installPrompt) return;
    installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
  }

  // Unsupported browser entirely
  if (!pushSupported) {
    return (
      <div className="card mt-4">
        <div className="section-title">🔔 Notifications</div>
        <p className="muted text-sm">
          Your browser doesn't support web push. Use Chrome/Android, or Safari on
          iOS 16.4+ after adding Crabopoly to your Home Screen.
        </p>
      </div>
    );
  }

  // iOS in a normal Safari tab: push only works from the installed app
  if (isIOS && !isStandalone) {
    return (
      <div className="card mt-4">
        <div className="section-title">🔔 Notifications</div>
        <p className="text-sm leading-relaxed">
          To get turn notifications on iPhone, add Crabopoly to your Home Screen
          first:
        </p>
        <ol className="text-sm leading-relaxed list-decimal list-inside mt-2 space-y-1">
          <li>Tap the <b>Share</b> button in Safari</li>
          <li>Tap <b>Add to Home Screen</b></li>
          <li>Open Crabopoly from your Home Screen</li>
          <li>Then turn on notifications here</li>
        </ol>
      </div>
    );
  }

  return (
    <div className="card mt-4">
      <div className="section-title">🔔 Notifications</div>
      {subscribed ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-green-700 font-semibold">
            ✅ Notifications are on — we'll ping you when it's your turn or someone sends a trade.
          </p>
          <button className="btn-ghost md:self-start" onClick={disable} disabled={busy}>
            Turn off
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-gray-600">
            Get pinged when it's your turn, so nobody has to spam the group chat.
          </p>
          {Notification.permission === "denied" ? (
            <p className="text-sm text-red-600">
              Notifications are blocked in your browser settings. Unblock them for this site, then refresh.
            </p>
          ) : (
            <button className="btn-primary w-full md:w-auto" onClick={enable} disabled={busy || !vapidKey}>
              {busy ? "Setting up…" : "Turn on notifications"}
            </button>
          )}
        </div>
      )}
      {installPrompt && (
        <button className="btn-gold w-full md:w-auto mt-3" onClick={installApp}>
          📲 Install Crabopoly on this device
        </button>
      )}
      {error && <p className="text-sm text-red-600 mt-2">{error}</p>}
      {ok && <p className="text-sm text-green-700 mt-2">{ok}</p>}
    </div>
  );
}
