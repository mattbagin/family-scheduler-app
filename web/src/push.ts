import { api } from './api.ts';

/*
 * Push notifications and install on this device. Browsers only allow both over https
 * (http://localhost excepted), and iPhones only after "Add to Home Screen".
 */

export type PushState = 'insecure' | 'install-first' | 'unsupported' | 'denied' | 'off' | 'on';

const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isInstalled = () => matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;

export function registerServiceWorker() {
  if ('serviceWorker' in navigator && isSecureContext) navigator.serviceWorker.register('/sw.js').catch(() => {});
}

async function registration(): Promise<ServiceWorkerRegistration> {
  return (await navigator.serviceWorker.getRegistration()) ?? navigator.serviceWorker.register('/sw.js');
}

export async function pushState(): Promise<PushState> {
  if (!isSecureContext) return 'insecure';
  const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  if (!supported) return isIos() && !isInstalled() ? 'install-first' : 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const sub = await (await registration()).pushManager.getSubscription();
  return sub ? 'on' : 'off';
}

/** A short name for the device, so parents can tell their phones apart. */
function deviceLabel(): string {
  const ua = navigator.userAgent;
  const device = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac/.test(ua) ? 'Mac' : 'Device';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : '';
  return browser ? `${browser} on ${device}` : device;
}

const keyBytes = (b64url: string) => {
  const s = atob(b64url.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
};

export async function turnOnPush(): Promise<void> {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Notifications weren’t allowed. You can allow them in this site’s browser settings.');
  const reg = await registration();
  await navigator.serviceWorker.ready;
  const { publicKey } = await api<{ publicKey: string }>('/push/key');
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
  await api('/push/subscribe', { method: 'POST', body: { ...sub.toJSON(), label: deviceLabel() } });
}

export async function turnOffPush(): Promise<void> {
  const sub = await (await registration()).pushManager.getSubscription();
  if (!sub) return;
  await api('/push/unsubscribe', { method: 'POST', body: { endpoint: sub.endpoint } });
  await sub.unsubscribe();
}

/* ---------- install ---------- */

interface InstallPrompt extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}
let installPrompt: InstallPrompt | null = null;
const installListeners = new Set<() => void>();

/** Chrome and Edge offer their own install prompt; keep it for an "Install Homebase" button. */
export function watchInstallPrompt() {
  addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    installPrompt = e as InstallPrompt;
    installListeners.forEach((fn) => fn());
  });
  addEventListener('appinstalled', () => {
    installPrompt = null;
    installListeners.forEach((fn) => fn());
  });
}

export const canInstall = () => !!installPrompt;
export const onInstallChange = (fn: () => void) => {
  installListeners.add(fn);
  return () => installListeners.delete(fn);
};
export async function install(): Promise<boolean> {
  if (!installPrompt) return false;
  await installPrompt.prompt();
  const { outcome } = await installPrompt.userChoice;
  installPrompt = null;
  installListeners.forEach((fn) => fn());
  return outcome === 'accepted';
}

/** How to install on this device when the browser has no prompt of its own. */
export function installHint(): string | null {
  if (isInstalled()) return null;
  if (isIos()) return 'On iPhone or iPad: tap Share, then “Add to Home Screen”, then open Homebase from there.';
  return null;
}
