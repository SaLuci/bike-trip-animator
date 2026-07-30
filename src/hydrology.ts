import waterData from './data/euHydroWater.json';
import type { LonLatBounds, Projection } from './types';

interface LakeFeature {
  rings: [number, number][][];
  name: string | null;
  area: number;
  cx: number;
  cy: number;
}

interface RiverPath {
  order: number;
  path: [number, number][];
}

const LAKES = waterData.lakes as unknown as LakeFeature[];
const RIVERS = waterData.rivers as unknown as RiverPath[];

/** No longer loads any external assets — kept for backward compat */
export async function ensureHydrologyAssetsLoaded() {
  return true;
}

/** Quadratic-bezier smooth closed ring — rounds corners so lake outlines look natural. */
function traceSmoothRing(ctx: CanvasRenderingContext2D, pts: [number, number][]) {
  const n = pts.length;
  if (n < 3) return;
  const mid = (a: [number, number], b: [number, number]): [number, number] => [
    (a[0] + b[0]) * 0.5,
    (a[1] + b[1]) * 0.5,
  ];
  const start = mid(pts[n - 1], pts[0]);
  ctx.moveTo(start[0], start[1]);
  for (let i = 0; i < n; i++) {
    const curr = pts[i];
    const next = pts[(i + 1) % n];
    const m = mid(curr, next);
    ctx.quadraticCurveTo(curr[0], curr[1], m[0], m[1]);
  }
  ctx.closePath();
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function inBounds(lon: number, lat: number, bounds: LonLatBounds): boolean {
  return lon >= bounds.minLon && lon <= bounds.maxLon && lat >= bounds.minLat && lat <= bounds.maxLat;
}

export function drawRivers(
  ctx: CanvasRenderingContext2D,
  project: Projection['project'],
  bounds: LonLatBounds,
  scale = 1
) {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#5aa9c9';
  for (const river of RIVERS) {
    const visible = river.path.some(([lon, lat]) => inBounds(lon, lat, bounds));
    if (!visible) continue;
    ctx.lineWidth = (river.order === 9 ? 2.2 : 1.2) * scale;
    ctx.beginPath();
    const pts = river.path.map(([lon, lat]) => project(lon, lat));
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.stroke();
  }
  ctx.restore();
}

/** Minimum lake area in m² to render (≈5 km²) — filters out tiny dot-like lakes. */
const MIN_LAKE_AREA = 5_000_000;

export function drawLakes(
  ctx: CanvasRenderingContext2D,
  project: Projection['project'],
  bounds: LonLatBounds,
  scale = 1
) {
  ctx.save();
  ctx.fillStyle = '#8fd0e0';
  ctx.strokeStyle = '#5b8cae';
  ctx.lineWidth = 0.9 * scale;
  for (const lake of LAKES) {
    if (lake.area < MIN_LAKE_AREA) continue;
    const visible = lake.rings[0].some(([lon, lat]) => inBounds(lon, lat, bounds));
    if (!visible) continue;
    ctx.beginPath();
    for (const ring of lake.rings) {
      const pts = ring.map(([lon, lat]) => project(lon, lat) as [number, number]);
      traceSmoothRing(ctx, pts);
    }
    ctx.fill('evenodd');
    ctx.stroke();
  }
  ctx.restore();
}

/** Draws lake name labels as a per-frame overlay so they can react to the zoom state. */
export function drawLakeLabelOverlays(
  ctx: CanvasRenderingContext2D,
  project: Projection['project'],
  bounds: LonLatBounds,
  camT: number,
  scale = 1
) {
  const alpha = clamp(1 - camT * 2.5, 0, 1);
  if (alpha <= 0.02) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const lake of LAKES) {
    if (!lake.name) continue;
    if (!inBounds(lake.cx, lake.cy, bounds)) continue;
    const [lx, ly] = project(lake.cx, lake.cy);
    const fontPx = clamp(7.6 + Math.log10(Math.max(1, lake.area)) - 5.5, 8, 13) * scale;
    ctx.font = `italic 600 ${fontPx}px system-ui, sans-serif`;
    ctx.lineWidth = Math.max(2 * scale, fontPx * 0.16);
    ctx.strokeStyle = 'rgba(255,255,255,0.88)';
    ctx.strokeText(lake.name, lx, ly);
    ctx.fillStyle = '#2b6f8f';
    ctx.fillText(lake.name, lx, ly);
  }
  ctx.restore();
}