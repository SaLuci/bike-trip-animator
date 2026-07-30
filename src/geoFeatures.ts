import placesData from './data/europePlaces10m.json';
import mountainData from './data/europeMountains10m.json';
import { haversineKm } from './geo';
import { drawMountainGlyph, getEuropeGeoData, type Pos } from './europeMap';
import type { LonLatBounds, Projection, TrackPoint } from './types';

function inBounds(lon: number, lat: number, bounds: LonLatBounds): boolean {
  return lon >= bounds.minLon && lon <= bounds.maxLon && lat >= bounds.minLat && lat <= bounds.maxLat;
}

// --- Country name labels --------------------------------------------------

/** Standard signed-area polygon centroid formula, applied in projected (pixel) space. */
function ringCentroid(pts: Array<[number, number]>): { cx: number; cy: number; area: number } {
  let area = 0;
  let cx = 0;
  let cy = 0;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[(i + 1) % n];
    const cross = x0 * y1 - x1 * y0;
    area += cross;
    cx += (x0 + x1) * cross;
    cy += (y0 + y1) * cross;
  }
  area *= 0.5;
  if (Math.abs(area) < 1e-6) {
    let sx = 0;
    let sy = 0;
    for (const [x, y] of pts) {
      sx += x;
      sy += y;
    }
    return { cx: sx / n, cy: sy / n, area: 0 };
  }
  return { cx: cx / (6 * area), cy: cy / (6 * area), area: Math.abs(area) };
}

const MIN_COUNTRY_LABEL_AREA_PX = 1400;

/** Writes each country's name centered on its largest landmass, skipping micro-states that would overflow. */
export function drawCountryLabels(ctx: CanvasRenderingContext2D, project: Projection['project'], scale = 1) {
  const { countries } = getEuropeGeoData();
  ctx.save();
  ctx.fillStyle = 'rgba(76,66,61,0.82)';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `700 ${13 * scale}px system-ui, sans-serif`;
  const minArea = MIN_COUNTRY_LABEL_AREA_PX * scale * scale;

  for (const f of countries.features) {
    if (!f.geometry || !f.properties?.name) continue;
    const geom = f.geometry as { type: string; coordinates: unknown };
    const outerRings: Pos[][] =
      geom.type === 'Polygon'
        ? [(geom.coordinates as Pos[][])[0]]
        : geom.type === 'MultiPolygon'
          ? (geom.coordinates as Pos[][][]).map((poly) => poly[0])
          : [];

    let best: { cx: number; cy: number; area: number } | null = null;
    for (const ring of outerRings) {
      const projected = ring.map((pos) => project(pos[0], pos[1]) as [number, number]);
      const c = ringCentroid(projected);
      if (!best || c.area > best.area) best = c;
    }
    if (!best || best.area < minArea) continue;
    ctx.fillText(f.properties.name.toUpperCase(), best.cx, best.cy);
  }
  ctx.restore();
}

// --- Major cities -----------------------------------------------------------

interface CityInfo {
  name: string;
  lon: number;
  lat: number;
}

interface PlaceInfo {
  name: string;
  lon: number;
  lat: number;
  popMax: number;
  labelRank: number;
  scalerank: number;
  adm0cap: boolean;
  worldcity: boolean;
  featurecla: string;
}

interface MountainInfo {
  name: string;
  lon: number;
  lat: number;
  elevation: number;
  scalerank: number;
  featurecla: string;
}

export interface RouteCityOverlayData {
  majorCities: PlaceInfo[];
  nearbyCities: PlaceInfo[];
}

const PLACES = placesData as PlaceInfo[];
const MOUNTAINS = mountainData as MountainInfo[];

const MAJOR_CITIES: CityInfo[] = [
  { name: 'Berlin', lon: 13.405, lat: 52.52 },
  { name: 'Munich', lon: 11.582, lat: 48.135 },
  { name: 'Hamburg', lon: 9.993, lat: 53.551 },
  { name: 'Frankfurt', lon: 8.682, lat: 50.11 },
  { name: 'Stuttgart', lon: 9.181, lat: 48.776 },
  { name: 'Vienna', lon: 16.373, lat: 48.208 },
  { name: 'Zurich', lon: 8.541, lat: 47.376 },
  { name: 'Bern', lon: 7.447, lat: 46.948 },
  { name: 'Milan', lon: 9.19, lat: 45.464 },
  { name: 'Rome', lon: 12.496, lat: 41.902 },
  { name: 'Turin', lon: 7.686, lat: 45.07 },
  { name: 'Venice', lon: 12.315, lat: 45.44 },
  { name: 'Naples', lon: 14.268, lat: 40.851 },
  { name: 'Florence', lon: 11.256, lat: 43.769 },
  { name: 'Bologna', lon: 11.343, lat: 44.494 },
  { name: 'Paris', lon: 2.352, lat: 48.857 },
  { name: 'Lyon', lon: 4.835, lat: 45.764 },
  { name: 'Marseille', lon: 5.369, lat: 43.296 },
  { name: 'Madrid', lon: -3.703, lat: 40.417 },
  { name: 'Barcelona', lon: 2.17, lat: 41.385 },
  { name: 'London', lon: -0.128, lat: 51.507 },
  { name: 'Amsterdam', lon: 4.895, lat: 52.37 },
  { name: 'Brussels', lon: 4.351, lat: 50.85 },
  { name: 'Prague', lon: 14.421, lat: 50.088 },
  { name: 'Warsaw', lon: 21.012, lat: 52.23 },
  { name: 'Budapest', lon: 19.04, lat: 47.498 },
  { name: 'Zagreb', lon: 15.977, lat: 45.815 },
  { name: 'Ljubljana', lon: 14.505, lat: 46.056 },
  { name: 'Copenhagen', lon: 12.568, lat: 55.676 },
  { name: 'Stockholm', lon: 18.068, lat: 59.329 },
  { name: 'Oslo', lon: 10.752, lat: 59.913 },
  { name: 'Helsinki', lon: 24.945, lat: 60.192 },
  { name: 'Athens', lon: 23.727, lat: 37.983 },
  { name: 'Lisbon', lon: -9.139, lat: 38.722 },
  { name: 'Dublin', lon: -6.26, lat: 53.349 },
  { name: 'Bratislava', lon: 17.107, lat: 48.148 },
  { name: 'Bucharest', lon: 26.103, lat: 44.427 },
  { name: 'Sofia', lon: 23.322, lat: 42.698 },
  { name: 'Belgrade', lon: 20.457, lat: 44.787 }
];

export function drawCityMarkers(
  ctx: CanvasRenderingContext2D,
  project: Projection['project'],
  bounds: LonLatBounds,
  scale = 1
) {
  ctx.save();
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.font = `600 ${11 * scale}px system-ui, sans-serif`;
  for (const city of MAJOR_CITIES) {
    if (!inBounds(city.lon, city.lat, bounds)) continue;
    const [x, y] = project(city.lon, city.lat);
    ctx.fillStyle = '#2b2b33';
    ctx.beginPath();
    ctx.arc(x, y, 3.2 * scale, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 1.2 * scale;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();

    ctx.fillStyle = 'rgba(30,35,30,0.85)';
    ctx.fillText(city.name, x + 6 * scale, y);
  }
  ctx.restore();
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function isMajorCity(place: PlaceInfo): boolean {
  return place.worldcity || place.adm0cap || place.popMax >= 800000 || place.labelRank <= 2;
}

function sampleRoute(route: TrackPoint[]): TrackPoint[] {
  if (route.length <= 240) return route;
  const step = Math.max(1, Math.ceil(route.length / 240));
  const sampled: TrackPoint[] = [];
  for (let index = 0; index < route.length; index += step) sampled.push(route[index]);
  const lastPoint = route[route.length - 1];
  if (sampled[sampled.length - 1] !== lastPoint) sampled.push(lastPoint);
  return sampled;
}

function nearestRouteDistanceKm(place: PlaceInfo, route: TrackPoint[]): number {
  const target: TrackPoint = { lon: place.lon, lat: place.lat };
  let best = Number.POSITIVE_INFINITY;
  for (const point of route) {
    best = Math.min(best, haversineKm(target, point));
  }
  return best;
}

function nearbyCityDistanceLimitKm(place: PlaceInfo): number {
  if (place.popMax >= 300000 || place.adm0cap) return 55;
  if (place.popMax >= 100000) return 40;
  if (place.popMax >= 50000) return 30;
  if (place.popMax >= 20000) return 24;
  return 16;
}

function projectIfVisible(
  project: Projection['project'],
  lon: number,
  lat: number,
  canvasWidth: number,
  canvasHeight: number,
  margin = 40
): [number, number] | null {
  const [x, y] = project(lon, lat);
  if (x < -margin || x > canvasWidth + margin || y < -margin || y > canvasHeight + margin) return null;
  return [x, y];
}

function drawCityLabel(
  ctx: CanvasRenderingContext2D,
  name: string,
  x: number,
  y: number,
  alpha: number,
  fontPx: number,
  dotRadius: number,
  scale: number
) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = '#2b2b33';
  ctx.beginPath();
  ctx.arc(x, y, dotRadius, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = Math.max(1, 1.1 * scale);
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.stroke();

  ctx.font = `600 ${fontPx}px system-ui, sans-serif`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 3 * scale;
  ctx.strokeStyle = 'rgba(255,255,255,0.82)';
  ctx.strokeText(name, x + 6 * scale, y);
  ctx.fillStyle = 'rgba(30,35,30,0.88)';
  ctx.fillText(name, x + 6 * scale, y);
  ctx.restore();
}

export function selectRouteCityOverlayData(route: TrackPoint[]): RouteCityOverlayData {
  const majorCities = PLACES
    .filter(isMajorCity)
    .sort((a, b) => b.popMax - a.popMax || a.name.localeCompare(b.name))
    .slice(0, 70);

  if (route.length < 2) return { majorCities, nearbyCities: [] };

  const sampledRoute = sampleRoute(route);
  const nearbyCities = PLACES
    .filter((place) => !isMajorCity(place))
    .map((place) => ({ place, distKm: nearestRouteDistanceKm(place, sampledRoute) }))
    .filter(({ place, distKm }) => distKm <= nearbyCityDistanceLimitKm(place))
    .sort((a, b) => a.distKm - b.distKm || b.place.popMax - a.place.popMax || a.place.name.localeCompare(b.place.name))
    .slice(0, 90)
    .map(({ place }) => place);

  return { majorCities, nearbyCities };
}

export function drawCityOverlays(
  ctx: CanvasRenderingContext2D,
  project: Projection['project'],
  overlays: RouteCityOverlayData,
  camT: number,
  canvasWidth: number,
  canvasHeight: number,
  scale = 1
) {
  const nearbyAlpha = clamp((0.72 - camT) / 0.72, 0, 1);
  if (nearbyAlpha > 0.02) {
    const nearbyFontPx = (9.5 + (1 - camT) * 1.5) * scale;
    for (const place of overlays.nearbyCities) {
      const projected = projectIfVisible(project, place.lon, place.lat, canvasWidth, canvasHeight, 36);
      if (!projected) continue;
      drawCityLabel(ctx, place.name, projected[0], projected[1], nearbyAlpha, nearbyFontPx, 2.6 * scale, scale);
    }
  }

  const majorAlpha = 0.56 + camT * 0.14;
  for (const place of overlays.majorCities) {
    const projected = projectIfVisible(project, place.lon, place.lat, canvasWidth, canvasHeight, 36);
    if (!projected) continue;
    drawCityLabel(ctx, place.name, projected[0], projected[1], majorAlpha, 10.8 * scale, 3.1 * scale, scale);
  }
}

export function drawMountainOverlays(
  ctx: CanvasRenderingContext2D,
  project: Projection['project'],
  camT: number,
  canvasWidth: number,
  canvasHeight: number,
  scale = 1
) {
  const minElevation = 700 + camT * 1800;
  const labelAlpha = clamp((0.46 - camT) / 0.46, 0, 1);

  for (const mountain of MOUNTAINS) {
    if (mountain.elevation < minElevation) continue;
    const projected = projectIfVisible(project, mountain.lon, mountain.lat, canvasWidth, canvasHeight, 50);
    if (!projected) continue;

    const elevationT = clamp((mountain.elevation - 500) / 3500, 0, 1);
    const glyphAlpha = clamp((0.82 - camT * 0.62) * (0.45 + elevationT * 0.55), 0.16, 1);
    const glyphScale = scale * (0.28 + elevationT * 0.28);

    ctx.save();
    ctx.globalAlpha = glyphAlpha;
    drawMountainGlyph(ctx, projected[0], projected[1], glyphScale);
    ctx.restore();

    if (labelAlpha > 0.02 && mountain.elevation >= 900) {
      ctx.save();
      ctx.globalAlpha = labelAlpha * (0.55 + elevationT * 0.45);
      ctx.font = `600 ${(8.5 + elevationT * 1.8) * scale}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.lineWidth = 3 * scale;
      ctx.strokeStyle = 'rgba(255,255,255,0.82)';
      ctx.strokeText(mountain.name, projected[0], projected[1] - (16 + elevationT * 7) * scale);
      ctx.fillStyle = 'rgba(54,66,48,0.92)';
      ctx.fillText(mountain.name, projected[0], projected[1] - (16 + elevationT * 7) * scale);
      ctx.restore();
    }
  }
}

export { drawRivers, drawLakes } from './hydrology';


// --- Sea / ocean name labels (text only, ocean fill already covers the water) ---

interface SeaInfo {
  name: string;
  lon: number;
  lat: number;
}

const SEAS: SeaInfo[] = [
  { name: 'North Sea', lon: 3.8, lat: 56.5 },
  { name: 'Baltic Sea', lon: 18.5, lat: 58.0 },
  { name: 'Mediterranean Sea', lon: 10.5, lat: 38.2 },
  { name: 'Adriatic Sea', lon: 14.8, lat: 42.8 },
  { name: 'Black Sea', lon: 34.0, lat: 43.5 }
];

export function drawSeaLabels(
  ctx: CanvasRenderingContext2D,
  project: Projection['project'],
  bounds: LonLatBounds,
  scale = 1
) {
  ctx.save();
  ctx.fillStyle = 'rgba(115,177,198,0.62)';
  ctx.font = `italic 700 ${13 * scale}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  for (const sea of SEAS) {
    if (!inBounds(sea.lon, sea.lat, bounds)) continue;
    const [x, y] = project(sea.lon, sea.lat);
    ctx.fillText(sea.name.toUpperCase(), x, y);
  }
  ctx.restore();
}
