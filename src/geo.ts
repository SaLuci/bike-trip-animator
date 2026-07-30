import type { TrackPoint, LonLatBounds, Projection } from './types';

const EARTH_RADIUS_KM = 6371.0088;
const DEG2RAD = Math.PI / 180;

/** Affine Mercator projection parameters — interpolating these smoothly pans/zooms the camera. */
export interface ProjectionParams {
  scale: number;
  offsetX: number;
  offsetY: number;
  x1: number;
  y2: number;
}

/** Fallback view showing all of Europe, used when no GPX data is loaded yet. */
export const DEFAULT_EUROPE_BOUNDS: LonLatBounds = {
  minLon: -22,
  maxLon: 40,
  minLat: 34,
  maxLat: 70
};

export function haversineKm(a: TrackPoint, b: TrackPoint): number {
  const dLat = (b.lat - a.lat) * DEG2RAD;
  const dLon = (b.lon - a.lon) * DEG2RAD;
  const lat1 = a.lat * DEG2RAD;
  const lat2 = b.lat * DEG2RAD;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function trackDistanceKm(points: TrackPoint[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += haversineKm(points[i - 1], points[i]);
  return total;
}

export function cumulativeDistances(points: TrackPoint[]): number[] {
  const cum = new Array(points.length).fill(0);
  for (let i = 1; i < points.length; i++) cum[i] = cum[i - 1] + haversineKm(points[i - 1], points[i]);
  return cum;
}

/** Returns the interpolated point at `targetDistKm` along the track (clamped to the track's range). */
export function pointAtDistance(points: TrackPoint[], cumDist: number[], targetDistKm: number): TrackPoint {
  if (points.length === 0) return { lat: 0, lon: 0 };
  if (points.length === 1) return points[0];
  const total = cumDist[cumDist.length - 1];
  const target = Math.max(0, Math.min(total, targetDistKm));
  let lo = 0;
  let hi = cumDist.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cumDist[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  const idx = Math.max(1, lo);
  const segStart = cumDist[idx - 1];
  const segEnd = cumDist[idx];
  const segFrac = segEnd > segStart ? (target - segStart) / (segEnd - segStart) : 0;
  const p0 = points[idx - 1];
  const p1 = points[idx];
  return {
    lat: p0.lat + (p1.lat - p0.lat) * segFrac,
    lon: p0.lon + (p1.lon - p0.lon) * segFrac
  };
}

/**
 * Finds the point on `points` that is geographically closest to `target`, and returns its
 * cumulative distance along the track. Used to "snap" a real ridden end-point onto a
 * separately-recorded planned route, in case the two don't line up exactly.
 */
export function findNearestDistanceOnTrack(target: TrackPoint, points: TrackPoint[], cumDist: number[]): number {
  if (points.length === 0) return 0;
  let bestDistKm = Infinity;
  let bestIdx = 0;
  for (let i = 0; i < points.length; i++) {
    const d = haversineKm(target, points[i]);
    if (d < bestDistKm) {
      bestDistKm = d;
      bestIdx = i;
    }
  }
  return cumDist[bestIdx];
}

/**
 * Returns the portion of `points` from `startDistKm` onward (with an interpolated point
 * inserted exactly at that distance as the new first point). Used to isolate "the rest of
 * the planned route, starting from wherever today's ride ended" for the reveal animation.
 */
export function sliceTrackFromDistance(points: TrackPoint[], cumDist: number[], startDistKm: number): TrackPoint[] {
  if (points.length === 0) return [];
  if (points.length === 1) return [points[0]];
  const total = cumDist[cumDist.length - 1];
  const start = Math.max(0, Math.min(total, startDistKm));
  const startPoint = pointAtDistance(points, cumDist, start);

  let lo = 0;
  let hi = cumDist.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cumDist[mid] < start) lo = mid + 1;
    else hi = mid;
  }
  const idx = Math.max(1, lo);
  return [startPoint, ...points.slice(idx)];
}

/**
 * Given a track and its precomputed cumulative distances, returns the interpolated point at
 * `fraction` (0..1) of the total distance, the polyline of points "revealed so far" — i.e.
 * constant-speed progressive reveal regardless of uneven GPS point spacing — and the
 * longitude delta over the last `headingLookbackKm`, used to tell whether the rider is
 * currently heading east ("rightish") or west ("leftish").
 */
export function progressiveReveal(
  points: TrackPoint[],
  cumDist: number[],
  fraction: number,
  headingLookbackKm = 0.4
): { current: TrackPoint; revealed: TrackPoint[]; headingDLon: number } {
  const clamped = Math.max(0, Math.min(1, fraction));
  if (points.length === 0) {
    return { current: { lat: 0, lon: 0 }, revealed: [], headingDLon: 0 };
  }
  if (points.length === 1) {
    return { current: points[0], revealed: [points[0]], headingDLon: 0 };
  }

  const total = cumDist[cumDist.length - 1];
  const targetDist = total * clamped;
  let lo = 0;
  let hi = cumDist.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cumDist[mid] < targetDist) lo = mid + 1;
    else hi = mid;
  }
  const idx = Math.max(1, lo);
  const segStart = cumDist[idx - 1];
  const segEnd = cumDist[idx];
  const segFrac = segEnd > segStart ? (targetDist - segStart) / (segEnd - segStart) : 0;
  const p0 = points[idx - 1];
  const p1 = points[idx];
  const current: TrackPoint = {
    lat: p0.lat + (p1.lat - p0.lat) * segFrac,
    lon: p0.lon + (p1.lon - p0.lon) * segFrac
  };
  const revealed = points.slice(0, idx);
  revealed.push(current);

  const backPoint = pointAtDistance(points, cumDist, targetDist - headingLookbackKm);
  const headingDLon = current.lon - backPoint.lon;

  return { current, revealed, headingDLon };
}

/** Picks at most `maxPoints` evenly-spaced points (always keeping the first/last) for cheap rendering of large tracks. */
export function downsampleForRender(points: TrackPoint[], maxPoints: number): TrackPoint[] {
  if (points.length <= maxPoints) return points;
  const stride = Math.ceil(points.length / maxPoints);
  const result: TrackPoint[] = [];
  for (let i = 0; i < points.length; i += stride) result.push(points[i]);
  const last = points[points.length - 1];
  if (result[result.length - 1] !== last) result.push(last);
  return result;
}

export function boundsOfTracks(tracks: TrackPoint[][]): LonLatBounds | null {
  let minLon = Infinity;
  let maxLon = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  let any = false;
  for (const track of tracks) {
    for (const p of track) {
      any = true;
      if (p.lon < minLon) minLon = p.lon;
      if (p.lon > maxLon) maxLon = p.lon;
      if (p.lat < minLat) minLat = p.lat;
      if (p.lat > maxLat) maxLat = p.lat;
    }
  }
  return any ? { minLon, maxLon, minLat, maxLat } : null;
}

/** The smallest bounds that contain both inputs — used to make sure the pre-rendered basemap always covers at least as much area as any camera view will need. */
export function unionBounds(a: LonLatBounds, b: LonLatBounds): LonLatBounds {
  return {
    minLon: Math.min(a.minLon, b.minLon),
    maxLon: Math.max(a.maxLon, b.maxLon),
    minLat: Math.min(a.minLat, b.minLat),
    maxLat: Math.max(a.maxLat, b.maxLat)
  };
}

function mercatorY(latDeg: number): number {
  const lat = Math.max(-85.05112878, Math.min(85.05112878, latDeg));
  return Math.log(Math.tan(Math.PI / 4 + (lat * DEG2RAD) / 2));
}

/** Expands `bounds` (if needed) so neither dimension is smaller than `minSpanDeg`, keeping its center. */
export function expandToMinSpan(bounds: LonLatBounds, minSpanDeg: number): LonLatBounds {
  const lonCenter = (bounds.minLon + bounds.maxLon) / 2;
  const latCenter = (bounds.minLat + bounds.maxLat) / 2;
  const halfLon = Math.max(bounds.maxLon - bounds.minLon, minSpanDeg) / 2;
  const halfLat = Math.max(bounds.maxLat - bounds.minLat, minSpanDeg) / 2;
  return {
    minLon: lonCenter - halfLon,
    maxLon: lonCenter + halfLon,
    minLat: latCenter - halfLat,
    maxLat: latCenter + halfLat
  };
}

/** Computes the affine Mercator projection parameters that contain-fit `bounds` inside a canvas. */
export function computeProjectionParams(
  bounds: LonLatBounds,
  canvasWidth: number,
  canvasHeight: number,
  paddingFraction: number
): ProjectionParams {
  const x1 = bounds.minLon * DEG2RAD;
  const x2 = bounds.maxLon * DEG2RAD;
  const y1 = mercatorY(bounds.minLat);
  const y2 = mercatorY(bounds.maxLat);
  const geoWidth = Math.max(1e-9, x2 - x1);
  const geoHeight = Math.max(1e-9, y2 - y1);
  const availW = canvasWidth * (1 - 2 * paddingFraction);
  const availH = canvasHeight * (1 - 2 * paddingFraction);
  const scale = Math.min(availW / geoWidth, availH / geoHeight);
  const drawnW = geoWidth * scale;
  const drawnH = geoHeight * scale;
  const offsetX = (canvasWidth - drawnW) / 2;
  const offsetY = (canvasHeight - drawnH) / 2;
  return { scale, offsetX, offsetY, x1, y2 };
}

export function projectWithParams(params: ProjectionParams, lon: number, lat: number): [number, number] {
  const x = lon * DEG2RAD;
  const y = mercatorY(lat);
  const px = params.offsetX + (x - params.x1) * params.scale;
  const py = params.offsetY + (params.y2 - y) * params.scale;
  return [px, py];
}

/** Builds a `Projection` (project function only) that contain-fits `bounds` inside a canvas. */
export function createProjection(
  bounds: LonLatBounds,
  canvasWidth: number,
  canvasHeight: number,
  paddingFraction: number
): Projection {
  const params = computeProjectionParams(bounds, canvasWidth, canvasHeight, paddingFraction);
  return { project: (lon, lat) => projectWithParams(params, lon, lat) };
}

/** Linearly interpolates between two projection parameter sets — a smooth pan+zoom "camera move". */
export function lerpProjectionParams(a: ProjectionParams, b: ProjectionParams, t: number): ProjectionParams {
  return {
    scale: a.scale + (b.scale - a.scale) * t,
    offsetX: a.offsetX + (b.offsetX - a.offsetX) * t,
    offsetY: a.offsetY + (b.offsetY - a.offsetY) * t,
    x1: a.x1 + (b.x1 - a.x1) * t,
    y2: a.y2 + (b.y2 - a.y2) * t
  };
}

export function easeInOutCubic(t: number): number {
  const c = Math.max(0, Math.min(1, t));
  return c < 0.5 ? 4 * c * c * c : 1 - (-2 * c + 2) ** 3 / 2;
}

/**
 * Returns the geographic lon/lat bounds that are visible on-screen for a given set of
 * projection params and canvas size.  This is the inverse of computeProjectionParams:
 * it maps the four canvas corners back through the projection to find the actual extents
 * that will be rendered — including any padding/margins around the data area.
 */
export function cameraVisibleBounds(
  params: ProjectionParams,
  canvasWidth: number,
  canvasHeight: number
): LonLatBounds {
  const xLeft  = params.x1 + (0            - params.offsetX) / params.scale;
  const xRight = params.x1 + (canvasWidth  - params.offsetX) / params.scale;
  const yTop   = params.y2 - (0            - params.offsetY) / params.scale;
  const yBot   = params.y2 - (canvasHeight - params.offsetY) / params.scale;
  // inverse Mercator: lat = (2*atan(exp(y)) - PI/2) / DEG2RAD
  const invMerc = (y: number) => ((2 * Math.atan(Math.exp(y)) - Math.PI / 2) / DEG2RAD);
  return {
    minLon: xLeft  / DEG2RAD,
    maxLon: xRight / DEG2RAD,
    minLat: invMerc(yBot),
    maxLat: invMerc(yTop),
  };
}

/**
 * Given the camera's current projection params (defined at output canvas size) and the
 * projection params used to pre-render a (possibly supersampled) static basemap layer,
 * returns the source rectangle to crop from that static layer so that, once scaled up to
 * fill the output canvas, it exactly reproduces the camera's current framing.
 */
export function cropRectFromCamera(
  camParams: ProjectionParams,
  camWidth: number,
  camHeight: number,
  staticParams: ProjectionParams
): { sx: number; sy: number; sw: number; sh: number } {
  const xLeft = camParams.x1 + (0 - camParams.offsetX) / camParams.scale;
  const xRight = camParams.x1 + (camWidth - camParams.offsetX) / camParams.scale;
  const yTop = camParams.y2 - (0 - camParams.offsetY) / camParams.scale;
  const yBottom = camParams.y2 - (camHeight - camParams.offsetY) / camParams.scale;

  const sx1 = staticParams.offsetX + (xLeft - staticParams.x1) * staticParams.scale;
  const sx2 = staticParams.offsetX + (xRight - staticParams.x1) * staticParams.scale;
  const sy1 = staticParams.offsetY + (staticParams.y2 - yTop) * staticParams.scale;
  const sy2 = staticParams.offsetY + (staticParams.y2 - yBottom) * staticParams.scale;

  return { sx: sx1, sy: sy1, sw: sx2 - sx1, sh: sy2 - sy1 };
}

