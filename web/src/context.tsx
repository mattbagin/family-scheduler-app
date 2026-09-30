import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ymd, type Member, type SessionInfo, type Ymd } from '@shared';
import { ApiError, errorText } from './api.ts';
import { useToast } from './ui.tsx';

export interface Family {
  familyName: string;
  members: Member[];
  byId: (id: number | null | undefined) => Member | undefined;
  session: SessionInfo;
  canEdit: boolean;
  /** The signed-in person, or null on the shared hub. */
  me: Member | null;
}

const FamilyCtx = createContext<Family | null>(null);

export function FamilyProvider({ value, children }: { value: Omit<Family, 'byId' | 'canEdit' | 'me'>; children: ReactNode }) {
  const full = useMemo<Family>(() => {
    const map = new Map(value.members.map((m) => [m.id, m]));
    const elevated = (value.session.elevatedUntil ?? 0) > Date.now();
    return {
      ...value,
      byId: (id) => (id ? map.get(id) : undefined),
      canEdit: value.session.canEdit || elevated,
      me: value.session.memberId ? (map.get(value.session.memberId) ?? null) : null,
    };
  }, [value]);
  return <FamilyCtx.Provider value={full}>{children}</FamilyCtx.Provider>;
}

export function useFamily(): Family {
  const f = useContext(FamilyCtx);
  if (!f) throw new Error('useFamily outside FamilyProvider');
  return f;
}

export const namesOf = (f: Family, ids: number[]) =>
  ids.map((id) => f.byId(id)?.name).filter(Boolean).join(' & ');

/** The current time, refreshed every 20 seconds; `today` rolls over at midnight. */
export function useNow() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 20_000);
    return () => clearInterval(t);
  }, []);
  const today: Ymd = ymd(now);
  const nowMin = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
  return { now, today, nowMin };
}

/**
 * Runs a change against the server, shows a toast on success or failure, and refreshes data
 * (the live socket also refreshes other screens). Resolves to undefined on failure.
 */
export function useAction() {
  const toast = useToast();
  const qc = useQueryClient();
  return useCallback(
    async <T,>(fn: () => Promise<T>, ok?: string | ((r: T) => string)): Promise<T | undefined> => {
      try {
        const r = await fn();
        if (ok) toast(typeof ok === 'function' ? ok(r) : ok);
        qc.invalidateQueries();
        return r;
      } catch (e) {
        if (!(e instanceof ApiError && e.code === 'locked')) toast(errorText(e));
        return undefined;
      }
    },
    [toast, qc],
  );
}
