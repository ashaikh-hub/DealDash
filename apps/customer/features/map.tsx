'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { Icon, pickText } from '@dealdash/app-shell';
import type { DealCard } from '@dealdash/validation';
import { TrackedCard, useT } from './parts';

/**
 * Live Deals map (Blueprint C-05 map / nearby). Pins sit at each deal's nearest branch in Web-Mercator, so positions and distances
 * are true. The base layer is a provider choice (configuration `customer.map.tileUrlTemplate`, a licensed tile service): without
 * one the map draws a plain canvas with distance rings around the customer (or the city centre). The map and its controls never
 * mirror in RTL (Customer MVP §15); the selected-deal card below it does.
 */
const TILE = 256;
const MIN_ZOOM = 9;
const MAX_ZOOM = 18;
const CLUSTER_PX = 34;
const RINGS_KM = [1, 3, 5];

export interface MapConfig {
  tileUrlTemplate: string | null;
  attribution: string | null;
}

const worldSize = (z: number) => TILE * 2 ** z;
function project(lat: number, lng: number, z: number) {
  const s = Math.sin((Math.max(-85, Math.min(85, lat)) * Math.PI) / 180);
  return {
    x: ((lng + 180) / 360) * worldSize(z),
    y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * worldSize(z),
  };
}
function unproject(x: number, y: number, z: number) {
  const n = Math.PI - (2 * Math.PI * y) / worldSize(z);
  return {
    lat: (180 / Math.PI) * Math.atan(Math.sinh(n)),
    lng: (x / worldSize(z)) * 360 - 180,
  };
}
const metersPerPixel = (lat: number, z: number) =>
  (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** z;

/** The zoom that shows every point (and the centre) inside the box. */
function fitZoom(
  points: Array<{ lat: number; lng: number }>,
  centre: { lat: number; lng: number },
  w: number,
  h: number,
) {
  for (let z = 16; z >= MIN_ZOOM; z--) {
    const c = project(centre.lat, centre.lng, z);
    const inside = points.every((p) => {
      const q = project(p.lat, p.lng, z);
      return Math.abs(q.x - c.x) < w / 2 - 28 && Math.abs(q.y - c.y) < h / 2 - 28;
    });
    if (inside) return z;
  }
  return MIN_ZOOM;
}

interface Pin {
  key: string;
  x: number;
  y: number;
  deals: DealCard[];
}

export function DealsMap({
  deals,
  centre,
  centreIsDevice,
  config,
}: {
  deals: DealCard[];
  centre: { lat: number; lng: number };
  centreIsDevice: boolean;
  config: MapConfig | null;
}) {
  const { t, locale } = useT();
  const box = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ w: 360, h: 420 });
  const located = useMemo(() => deals.filter((d) => d.nearestBranch), [deals]);
  const [view, setView] = useState<{ lat: number; lng: number; z: number } | null>(null);
  const [selected, setSelected] = useState<DealCard[] | null>(null);
  const drag = useRef<{ x: number; y: number; lat: number; lng: number; moved: boolean } | null>(
    null,
  );

  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([e]) => {
      if (e) setSize({ w: Math.round(e.contentRect.width), h: Math.round(e.contentRect.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fit = useCallback(() => {
    const pts = located.map((d) => ({
      lat: d.nearestBranch!.latitude,
      lng: d.nearestBranch!.longitude,
    }));
    setView({ ...centre, z: fitZoom(pts, centre, size.w, size.h) });
  }, [located, centre, size.w, size.h]);
  // first fit (and again when the deals or the centre change)
  useEffect(() => {
    fit();
    setSelected(null);
  }, [fit]);

  const v = view ?? { ...centre, z: 13 };
  const origin = project(v.lat, v.lng, v.z);
  const toScreen = (lat: number, lng: number) => {
    const p = project(lat, lng, v.z);
    return { x: p.x - origin.x + size.w / 2, y: p.y - origin.y + size.h / 2 };
  };

  // greedy clustering in screen space: pins closer than CLUSTER_PX share one marker
  const pins: Pin[] = [];
  for (const d of located) {
    const s = toScreen(d.nearestBranch!.latitude, d.nearestBranch!.longitude);
    const near = pins.find((p) => Math.hypot(p.x - s.x, p.y - s.y) < CLUSTER_PX);
    if (near) near.deals.push(d);
    else pins.push({ key: d.id, x: s.x, y: s.y, deals: [d] });
  }
  const me = toScreen(centre.lat, centre.lng);
  const mpp = metersPerPixel(v.lat, v.z);

  const zoomBy = (dz: number, at?: { lat: number; lng: number }) =>
    setView((cur) => {
      const base = cur ?? v;
      const z = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, base.z + dz));
      return { lat: at?.lat ?? base.lat, lng: at?.lng ?? base.lng, z };
    });

  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button')) return;
    drag.current = { x: e.clientX, y: e.clientY, lat: v.lat, lng: v.lng, moved: false };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
    const start = project(d.lat, d.lng, v.z);
    const next = unproject(start.x - dx, start.y - dy, v.z);
    setView({ ...next, z: v.z });
  };
  const onUp = () => {
    drag.current = null;
  };

  // licensed tiles (only when configured): the tiles that cover the box at the current zoom
  const tiles: Array<{ key: string; src: string; left: number; top: number }> = [];
  if (config?.tileUrlTemplate) {
    const n = 2 ** v.z;
    const x0 = Math.floor((origin.x - size.w / 2) / TILE);
    const x1 = Math.floor((origin.x + size.w / 2) / TILE);
    const y0 = Math.max(0, Math.floor((origin.y - size.h / 2) / TILE));
    const y1 = Math.min(n - 1, Math.floor((origin.y + size.h / 2) / TILE));
    for (let x = x0; x <= x1; x++)
      for (let y = y0; y <= y1; y++) {
        const wx = ((x % n) + n) % n;
        tiles.push({
          key: `${v.z}/${x}/${y}`,
          src: config.tileUrlTemplate
            .replace('{z}', String(v.z))
            .replace('{x}', String(wx))
            .replace('{y}', String(y)),
          left: x * TILE - origin.x + size.w / 2,
          top: y * TILE - origin.y + size.h / 2,
        });
      }
  }

  const missing = deals.length - located.length;
  const place = centreIsDevice ? t('map.youAreHere') : t('map.cityCentre');
  return (
    <div className="dd-stack" style={{ gap: 10 }} data-testid="deals-map">
      {located.length === 0 ? (
        <div className="dd-state" role="status">
          <div className="dd-state__title">{t('map.empty')}</div>
        </div>
      ) : null}
      <div
        ref={box}
        className={`dd-map ${config?.tileUrlTemplate ? '' : 'dd-map--plain'}`}
        dir="ltr"
        role="region"
        aria-label={t('map.label')}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onKeyDown={(e) => {
          if (e.key === '+' || e.key === '=') zoomBy(1);
          if (e.key === '-') zoomBy(-1);
        }}
        tabIndex={0}
      >
        {tiles.map((tl) => (
          <img
            key={tl.key}
            className="dd-map__tile"
            src={tl.src}
            alt=""
            draggable={false}
            style={{ left: tl.left, top: tl.top }}
          />
        ))}
        {!config?.tileUrlTemplate ? (
          <svg className="dd-map__rings" width={size.w} height={size.h} aria-hidden="true">
            {RINGS_KM.map((km) => (
              <g key={km}>
                <circle cx={me.x} cy={me.y} r={(km * 1000) / mpp} />
                <text x={me.x + (km * 1000) / mpp + 4} y={me.y - 4}>
                  {km} km
                </text>
              </g>
            ))}
          </svg>
        ) : null}
        <span
          className={`dd-map__me ${centreIsDevice ? '' : 'dd-map__me--city'}`}
          style={{ left: me.x, top: me.y }}
          title={place}
          aria-label={place}
          role="img"
        />
        {pins.map((p) => {
          const first = p.deals[0]!;
          const label =
            p.deals.length > 1
              ? t('map.dealsHere', { n: p.deals.length })
              : `${pickText(first.title, locale)} · ${pickText(first.merchantName, locale)}`;
          const active = selected?.some((s) => p.deals.some((d) => d.id === s.id));
          return (
            <button
              key={p.key}
              type="button"
              className={`dd-map__pin ${p.deals.length > 1 ? 'dd-map__pin--cluster' : ''} ${active ? 'dd-map__pin--active' : ''}`}
              style={{ left: p.x, top: p.y }}
              aria-label={label}
              aria-pressed={!!active}
              data-testid="map-pin"
              onClick={() => {
                if (p.deals.length > 1 && v.z < MAX_ZOOM - 1) {
                  const b = first.nearestBranch!;
                  zoomBy(2, { lat: b.latitude, lng: b.longitude });
                  setSelected(p.deals);
                } else setSelected(p.deals);
              }}
            >
              {p.deals.length > 1 ? (
                p.deals.length
              ) : (
                <span lang={locale}>{pickText(first.merchantName, locale).slice(0, 1)}</span>
              )}
            </button>
          );
        })}
        <div className="dd-map__controls">
          <button type="button" aria-label={t('map.zoomIn')} onClick={() => zoomBy(1)}>
            <Icon name="plus" size={18} />
          </button>
          <button type="button" aria-label={t('map.zoomOut')} onClick={() => zoomBy(-1)}>
            <Icon name="minus" size={18} />
          </button>
          <button type="button" aria-label={t('map.recenter')} onClick={fit}>
            <Icon name="locate" size={18} />
          </button>
        </div>
        {config?.attribution ? (
          <span className="dd-map__attribution">{config.attribution}</span>
        ) : null}
      </div>
      {!config?.tileUrlTemplate && located.length ? (
        <span className="dd-caption">{t('map.rings', { place })}</span>
      ) : null}
      {missing > 0 ? (
        <span className="dd-caption">{t('map.noLocation', { n: missing })}</span>
      ) : null}
      {selected ? (
        <div className="dd-stack" aria-live="polite" data-testid="map-selection">
          <div className="dd-row" style={{ justifyContent: 'flex-end' }}>
            <button type="button" className="dd-link" onClick={() => setSelected(null)}>
              {t('map.close')}
            </button>
          </div>
          <div className="dd-cardgrid">
            {selected.map((d) => (
              <TrackedCard key={d.id} deal={d} variant="list" />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
