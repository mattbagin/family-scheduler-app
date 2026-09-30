export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

type UnlockHandler = () => Promise<boolean>;
let unlockHandler: UnlockHandler | null = null;
let signedOutHandler: (() => void) | null = null;

/** Called when the server says a parent must unlock; resolves true once they have. */
export function onUnlockNeeded(fn: UnlockHandler) {
  unlockHandler = fn;
}

export function onSignedOut(fn: () => void) {
  signedOutHandler = fn;
}

export async function api<T>(path: string, opts: { method?: string; body?: unknown } = {}, retry = true): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: opts.method ?? 'GET',
      headers: opts.body !== undefined ? { 'content-type': 'application/json' } : undefined,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      credentials: 'same-origin',
    });
  } catch {
    throw new ApiError(0, 'offline', 'Can’t reach the home server. Check the Wi-Fi or Tailscale connection.');
  }
  // No-content replies (deletes) resolve to true so callers can tell success from failure.
  if (res.status === 204) return true as T;
  const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
  if (!res.ok) {
    if (res.status === 403 && data.error === 'locked' && retry && unlockHandler && (await unlockHandler())) {
      return api<T>(path, opts, false);
    }
    if (res.status === 401 && data.error === 'signed_out') signedOutHandler?.();
    throw new ApiError(res.status, data.error ?? 'error', data.message ?? res.statusText);
  }
  return data as T;
}

export const errorText = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong');
