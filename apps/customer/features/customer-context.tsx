'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useAuth } from '@dealdash/app-shell';
import { DEFAULT_CITY, RIYADH_CENTER } from '@dealdash/types';

export type LocationStatus = 'idle' | 'finding' | 'ok' | 'denied' | 'unavailable';

export interface CityOption {
  name: string;
  nameAr: string;
  latitude: number | null;
  longitude: number | null;
}

export interface CustomerContextValue {
  city: string;
  /** Enabled cities from the server configuration (nothing about a specific city is hard-coded in the app). */
  cities: CityOption[];
  setCity: (name: string) => void;
  /** Device coordinates when the customer shared them, otherwise the city centre (flagged `approximate`). */
  coords: { lat: number; lng: number };
  approximate: boolean;
  status: LocationStatus;
  requestLocation: () => void;
  anonymousId: string;
  track: (event: TrackedEvent) => void;
  /** Live Deals map base layer from server configuration (null template = plain canvas). */
  mapConfig: { tileUrlTemplate: string | null; attribution: string | null } | null;
  /** A city's display name in the interface language (Arabic name in Arabic; the English name otherwise). */
  cityLabel: (name: string, ui: string) => string;
}

export interface TrackedEvent {
  type: 'IMPRESSION' | 'DETAIL_VIEW' | 'MERCHANT_PAGE_VIEW' | 'DIRECTIONS_CLICK' | 'CTA_CLICK';
  dealId?: string;
  merchantId?: string;
  branchId?: string;
  sourceDealId?: string;
  /** Which product dealId refers to (Live Deals are the default). */
  product?: 'LIVE' | 'HOT' | 'VOUCHER' | 'WATCH';
}

const Ctx = createContext<CustomerContextValue | null>(null);
export const useCustomer = () => {
  const v = useContext(Ctx);
  if (!v) throw new Error('useCustomer must be used inside <CustomerProvider>');
  return v;
};

const safe = {
  get(storage: 'local' | 'session', key: string): string | null {
    try {
      return (storage === 'local' ? localStorage : sessionStorage).getItem(key);
    } catch {
      return null;
    }
  },
  set(storage: 'local' | 'session', key: string, value: string) {
    try {
      (storage === 'local' ? localStorage : sessionStorage).setItem(key, value);
    } catch {
      /* storage unavailable (private mode): the app still works */
    }
  },
};

function newAnonymousId() {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return 'dev-' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Location stays on the device (session storage) and is only sent as query parameters to sort by distance.
 * Discovery events carry a random per-device id, never a name, phone number or exact location.
 */
export function CustomerProvider({ children }: { children: ReactNode }) {
  const { apiUrl, setMarketCity } = useAuth();
  const [device, setDevice] = useState<{ lat: number; lng: number } | null>(null);
  const [cities, setCities] = useState<CityOption[]>([]);
  const [city, setCityState] = useState<string>(DEFAULT_CITY); // replaced by the configured default as soon as it loads
  const [status, setStatus] = useState<LocationStatus>('idle');
  const [mapConfig, setMapConfig] = useState<CustomerContextValue['mapConfig']>(null);
  const [anonymousId, setAnonymousId] = useState('dev-pending-id');
  const queue = useRef<Array<TrackedEvent & { anonymousId: string }>>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // the chosen city's market decides the currency and time zone shown where a value carries none of its own
  useEffect(() => {
    setMarketCity(city);
  }, [city, setMarketCity]);

  useEffect(() => {
    let id = safe.get('local', 'dd_anon');
    if (!id) {
      id = newAnonymousId();
      safe.set('local', 'dd_anon', id);
    }
    setAnonymousId(id);
    const stored = safe.get('session', 'dd_loc');
    if (stored) {
      try {
        const p = JSON.parse(stored) as { lat: number; lng: number };
        if (typeof p.lat === 'number' && typeof p.lng === 'number') {
          setDevice(p);
          setStatus('ok');
        }
      } catch {
        /* ignore corrupt value */
      }
    }
  }, []);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await fetch(`${apiUrl}/v1/app/config`);
        const body = (await res.json()) as {
          data?: {
            defaultCity: string;
            cities: CityOption[];
            map?: CustomerContextValue['mapConfig'];
          };
        };
        if (
          !alive ||
          !body.data ||
          !Array.isArray(body.data.cities) ||
          typeof body.data.defaultCity !== 'string'
        )
          return;
        setCities(body.data.cities);
        setMapConfig(body.data.map ?? null);
        const saved = safe.get('session', 'dd_city');
        const known = body.data.cities.some((c) => c.name === saved);
        setCityState(known && saved ? saved : body.data.defaultCity);
      } catch {
        /* offline: the built-in fallback city keeps the app usable */
      }
    })();
    return () => {
      alive = false;
    };
  }, [apiUrl]);

  const setCity = useCallback((name: string) => {
    setCityState(name);
    safe.set('session', 'dd_city', name);
  }, []);

  const requestLocation = useCallback(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setStatus('unavailable');
      return;
    }
    setStatus('finding');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const p = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setDevice(p);
        setStatus('ok');
        safe.set('session', 'dd_loc', JSON.stringify(p));
      },
      (err) => setStatus(err.code === err.PERMISSION_DENIED ? 'denied' : 'unavailable'),
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 300_000 },
    );
  }, []);

  const flush = useCallback(async () => {
    timer.current = null;
    const events = queue.current.splice(0, 50);
    if (!events.length) return;
    try {
      await fetch(`${apiUrl}/v1/app/events`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ events }),
        keepalive: true,
      });
    } catch {
      /* discovery signals are best effort and never block the customer */
    }
  }, [apiUrl]);

  const track = useCallback(
    (event: TrackedEvent) => {
      if (anonymousId === 'dev-pending-id') return;
      queue.current.push({ ...event, anonymousId });
      if (!timer.current) timer.current = setTimeout(() => void flush(), 800);
    },
    [anonymousId, flush],
  );

  const value = useMemo<CustomerContextValue>(() => {
    const centre = cities.find((c) => c.name === city);
    return {
      city,
      cities,
      setCity,
      coords:
        device ??
        (centre?.latitude != null && centre.longitude != null
          ? { lat: centre.latitude, lng: centre.longitude }
          : { lat: RIYADH_CENTER.latitude, lng: RIYADH_CENTER.longitude }),
      approximate: !device,
      status,
      requestLocation,
      anonymousId,
      track,
      mapConfig,
      cityLabel: (name: string, ui: string) =>
        ui === 'ar' ? (cities.find((c) => c.name === name)?.nameAr ?? name) : name,
    };
  }, [device, status, requestLocation, anonymousId, track, city, cities, setCity, mapConfig]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Records an impression once the card was at least half visible for a second (LD-61, simplified). */
export function useImpression(
  dealId: string,
  branchId?: string,
  product?: 'LIVE' | 'HOT' | 'VOUCHER' | 'WATCH',
) {
  const { track } = useCustomer();
  const el = useRef<HTMLElement | null>(null);
  const sent = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const node = el.current;
    if (!node || sent.current || typeof IntersectionObserver === 'undefined') return;
    const obs = new IntersectionObserver(
      (entries) => {
        const visible = entries.some((e) => e.isIntersecting && e.intersectionRatio >= 0.5);
        if (visible && !timer.current && !sent.current) {
          timer.current = setTimeout(() => {
            sent.current = true;
            track({ type: 'IMPRESSION', dealId, branchId, product });
            obs.disconnect();
          }, 1000);
        } else if (!visible && timer.current) {
          clearTimeout(timer.current);
          timer.current = null;
        }
      },
      { threshold: [0, 0.5, 1] },
    );
    obs.observe(node);
    return () => {
      obs.disconnect();
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
    };
  }, [dealId, branchId, product, track]);
  return useCallback((node: HTMLElement | null) => {
    el.current = node;
  }, []);
}
