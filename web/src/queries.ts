import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import type { Bill, Bootstrap, Calendar, ChoreForDay, HubSettings, LiveTopic, Occurrence, Plan, PrepItem, Todo, Weather, Ymd } from '@shared';
import { api } from './api.ts';

export const useBootstrap = () => useQuery({ queryKey: ['bootstrap'], queryFn: () => api<Bootstrap>('/bootstrap') });

export const useOccurrences = (from: Ymd, to: Ymd, enabled = true) =>
  useQuery({
    queryKey: ['occurrences', from, to],
    queryFn: () => api<Occurrence[]>(`/occurrences?from=${from}&to=${to}`),
    enabled,
    placeholderData: (prev) => prev,
  });

export const usePlans = () => useQuery({ queryKey: ['plans'], queryFn: () => api<Plan[]>('/plans') });
export const useChores = (date: Ymd) => useQuery({ queryKey: ['chores', date], queryFn: () => api<ChoreForDay[]>(`/chores?date=${date}`) });
export const useBills = () => useQuery({ queryKey: ['bills'], queryFn: () => api<Bill[]>('/bills') });
export const useTodos = () => useQuery({ queryKey: ['todos'], queryFn: () => api<Todo[]>('/todos') });
/** What to get ready from today on; today's bring notes drop off once their event has started. */
export function usePrep(today: Ymd, to: Ymd, nowMin: number) {
  const q = useQuery({ queryKey: ['prep', today, to], queryFn: () => api<PrepItem[]>(`/prep?from=${today}&to=${to}`), placeholderData: (prev) => prev });
  const items = (q.data ?? []).filter((p) => p.date !== today || p.startMin === null || p.startMin > nowMin);
  return { ...q, data: items };
}
export const useCalendars = () => useQuery({ queryKey: ['calendars'], queryFn: () => api<Calendar[]>('/calendars') });

/** The subscribed calendar an event comes from; undefined for the family's own events. */
export function useFeed(calendarId: number | null | undefined): Calendar | undefined {
  const { data } = useCalendars();
  return calendarId == null ? undefined : data?.find((c) => c.id === calendarId && c.kind === 'ics');
}

export type HubInfo = HubSettings & { photoCount: number | null };
export const useHub = () => useQuery({ queryKey: ['hub'], queryFn: () => api<HubInfo>('/hub-settings'), staleTime: 60_000 });
/** The forecast for the home location (null until one is set). Quietly empty when it can't be reached. */
export const useWeather = () =>
  useQuery({
    queryKey: ['weather'],
    queryFn: () => api<{ weather: Weather | null }>('/weather').then((r) => r.weather),
    refetchInterval: 20 * 60_000,
    staleTime: 10 * 60_000,
    retry: false,
  });
export const usePhotos = (enabled: boolean) =>
  useQuery({ queryKey: ['photos'], queryFn: () => api<string[]>('/photos'), enabled, staleTime: 5 * 60_000 });

const TOPIC_KEYS: Record<LiveTopic, string[][]> = {
  events: [['occurrences'], ['plans'], ['prep']],
  plans: [['plans'], ['occurrences']],
  chores: [['chores']],
  bills: [['bills']],
  members: [['bootstrap'], ['occurrences'], ['plans'], ['chores'], ['calendars'], ['todos'], ['prep']],
  settings: [['bootstrap']],
  calendars: [['calendars']],
  todos: [['todos'], ['prep']],
  nudges: [['nudges']],
  hub: [['hub'], ['weather'], ['photos']],
};

/**
 * Keeps this screen in sync with every other device: the server pushes which topics changed
 * and we refetch those. Reconnects with backoff; returns whether we're connected.
 */
export function useLiveSync(enabled: boolean): boolean {
  const qc = useQueryClient();
  const [connected, setConnected] = useState(true);
  useEffect(() => {
    if (!enabled) return;
    let ws: WebSocket | null = null;
    let retry = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const connect = () => {
      ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/live`);
      ws.onopen = () => {
        if (retry > 0) qc.invalidateQueries(); // catch up on anything missed while offline
        retry = 0;
        setConnected(true);
      };
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data as string) as { type: string; topics?: LiveTopic[] };
        // A nudge just fired somewhere: the banner component decides whether to chime.
        if (msg.type === 'nudge') dispatchEvent(new CustomEvent('hb-nudge', { detail: msg }));
        if (msg.type !== 'changed') return;
        for (const t of msg.topics ?? []) for (const key of TOPIC_KEYS[t] ?? []) qc.invalidateQueries({ queryKey: key });
      };
      ws.onclose = () => {
        if (stopped) return;
        setConnected(false);
        retry++;
        timer = setTimeout(connect, Math.min(30_000, 1000 * 2 ** Math.min(retry, 5)));
      };
    };
    connect();
    return () => {
      stopped = true;
      clearTimeout(timer);
      ws?.close();
    };
  }, [enabled, qc]);
  return connected;
}
