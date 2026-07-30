import * as topojson from 'topojson-client';
import countries10m from './data/europeCountries10m.topo.json';
import mountainData from './data/europeMountains10m.json';
import type { Topology, GeometryObject } from 'topojson-specification';
import type { LonLatBounds, Projection } from './types';
import { COLORS } from './constants';

export type Pos = number[];
export interface GeoFeature {
  type: string;
  properties?: { name?: string };
  geometry: { type: string; coordinates: unknown } | null;
}
export interface GeoFeatureCollection {
  type: string;
  features: GeoFeature[];
}
interface GeoMultiLineString {
  type: string;
  coordinates: Pos[][];
}

interface MountainPointInfo {
  name: string;
  lon: number;
  lat: number;
  elevation: number;
  scalerank: number;
  featurecla: string;
}

interface StyledMountainPointInfo extends MountainPointInfo {
  countryName: string;
  hue: number;
  baseSaturation: number;
  baseLightness: number;
}

const topology = countries10m as unknown as Topology<{ countries: GeometryObject }>;
const MOUNTAIN_POINTS = mountainData as MountainPointInfo[];
const EUROPE_RELIEF_BOUNDS = { minLon: -20, maxLon: 45, minLat: 30, maxLat: 72 } as const;

let cachedCountries: GeoFeatureCollection | null = null;
let cachedBorders: GeoMultiLineString | null = null;
let cachedCountryReliefByName: Map<string, number> | null = null;
let cachedStyledMountainPoints: StyledMountainPointInfo[] | null = null;

async function loadReliefRaster() {
  const img = new Image();
  img.decoding = 'async';
  img.src = new URL('./data/europeRelief50m.png', import.meta.url).href;
  await img.decode();

  const sampleWidth = 1200;
  const sampleHeight = Math.round((img.height / img.width) * sampleWidth);
  const canvas = document.createElement('canvas');
  canvas.width = sampleWidth;
  canvas.height = sampleHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context is not available for relief raster.');
  ctx.drawImage(img, 0, 0, sampleWidth, sampleHeight);
  const imageData = ctx.getImageData(0, 0, sampleWidth, sampleHeight);
  return {
    width: sampleWidth,
    height: sampleHeight,
    data: imageData.data
  };
}

const RELIEF_RASTER = await loadReliefRaster();

export function getEuropeGeoData() {
  if (!cachedCountries || !cachedBorders) {
    cachedCountries = topojson.feature(
      topology,
      topology.objects.countries
    ) as unknown as GeoFeatureCollection;
    cachedBorders = topojson.mesh(
      topology,
      topology.objects.countries,
      (a, b) => a !== b
    ) as unknown as GeoMultiLineString;
  }
  return { countries: cachedCountries, borders: cachedBorders };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

/** Small deterministic hash so each country gets a consistent (but varied) land color. */
function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

function pointInRing(lon: number, lat: number, ring: Pos[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersects = yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / ((yj - yi) || 1e-12) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function pointInPolygon(lon: number, lat: number, polygon: Pos[][]): boolean {
  if (polygon.length === 0 || !pointInRing(lon, lat, polygon[0])) return false;
  for (let index = 1; index < polygon.length; index++) {
    if (pointInRing(lon, lat, polygon[index])) return false;
  }
  return true;
}

function pointInGeometry(lon: number, lat: number, geom: { type: string; coordinates: unknown }): boolean {
  if (geom.type === 'Polygon') return pointInPolygon(lon, lat, geom.coordinates as Pos[][]);
  if (geom.type === 'MultiPolygon') {
    return (geom.coordinates as Pos[][][]).some((polygon) => pointInPolygon(lon, lat, polygon));
  }
  return false;
}

function getCountryReliefByName(): Map<string, number> {
  if (!cachedCountryReliefByName) {
    const { countries } = getEuropeGeoData();
    cachedCountryReliefByName = new Map<string, number>();
    for (const feature of countries.features) {
      const name = feature.properties?.name;
      if (!name || !feature.geometry) continue;
      const geom = feature.geometry as { type: string; coordinates: unknown };
      const elevations = MOUNTAIN_POINTS
        .filter((point) => pointInGeometry(point.lon, point.lat, geom))
        .map((point) => point.elevation)
        .sort((a, b) => b - a);

      let reliefMeters = 80;
      if (elevations.length > 0) {
        const avgElevation = elevations.reduce((sum, elevation) => sum + elevation, 0) / elevations.length;
        reliefMeters = avgElevation * 0.65 + elevations[0] * 0.35;
      }
      cachedCountryReliefByName.set(name, reliefMeters);
    }
  }
  return cachedCountryReliefByName;
}

const BASE_COUNTRY_PALETTE = [
  { hue: 352, saturation: 52, lightness: 86 },
  { hue: 18, saturation: 66, lightness: 84 },
  { hue: 52, saturation: 84, lightness: 79 },
  { hue: 84, saturation: 44, lightness: 80 },
  { hue: 118, saturation: 40, lightness: 79 },
  { hue: 152, saturation: 38, lightness: 81 },
  { hue: 188, saturation: 42, lightness: 82 },
  { hue: 214, saturation: 44, lightness: 83 },
  { hue: 248, saturation: 34, lightness: 84 },
  { hue: 286, saturation: 36, lightness: 85 }
] as const;

function countryColorComponents(name: string, reliefMeters: number): {
  hue: number;
  saturation: number;
  lightness: number;
} {
  const reliefT = clamp(Math.log1p(reliefMeters) / Math.log1p(4000), 0, 1);
  const hash = hashStr(name);
  const base = BASE_COUNTRY_PALETTE[hash % BASE_COUNTRY_PALETTE.length];
  const hue = (base.hue + ((hash >>> 4) % 7) - 3 + 360) % 360;
  const saturation = clamp(base.saturation + (((hash >>> 8) % 7) - 3) + reliefT * 6, 28, 78);
  const lightness = clamp(base.lightness - reliefT * 3 + (((hash >>> 12) % 5) - 2) * 0.9, 66, 90);
  return { hue, saturation, lightness };
}

function countryFillColor(name: string, reliefMeters: number): string {
  const { hue, saturation, lightness } = countryColorComponents(name, reliefMeters);
  return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
}

function getStyledMountainPoints(): StyledMountainPointInfo[] {
  if (!cachedStyledMountainPoints) {
    const { countries } = getEuropeGeoData();
    const reliefByName = getCountryReliefByName();
    cachedStyledMountainPoints = MOUNTAIN_POINTS.map((point) => {
      let countryName = '';
      for (const feature of countries.features) {
        if (!feature.geometry || !feature.properties?.name) continue;
        const geom = feature.geometry as { type: string; coordinates: unknown };
        if (pointInGeometry(point.lon, point.lat, geom)) {
          countryName = feature.properties.name;
          break;
        }
      }
      const reliefMeters = reliefByName.get(countryName) ?? point.elevation;
      const components = countryColorComponents(countryName || point.name, reliefMeters);
      return {
        ...point,
        countryName,
        hue: components.hue,
        baseSaturation: components.saturation,
        baseLightness: components.lightness
      };
    });
  }
  return cachedStyledMountainPoints;
}

function traceProjectedRing(ctx: CanvasRenderingContext2D, ring: Array<[number, number]>) {
  ring.forEach(([x, y], index) => {
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.closePath();
}

function projectedRingBounds(ring: Array<[number, number]>) {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const [x, y] of ring) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

function sqDistanceToSegment(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number
): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) {
    const ox = px - x1;
    const oy = py - y1;
    return ox * ox + oy * oy;
  }
  const t = clamp(((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy), 0, 1);
  const cx = x1 + dx * t;
  const cy = y1 + dy * t;
  const ox = px - cx;
  const oy = py - cy;
  return ox * ox + oy * oy;
}

function traceAllLand(ctx: CanvasRenderingContext2D, project: Projection['project']) {
  const { countries } = getEuropeGeoData();
  for (const feature of countries.features) {
    if (!feature.geometry) continue;
    const geom = feature.geometry as { type: string; coordinates: unknown };
    const polygons: Pos[][][] =
      geom.type === 'Polygon'
        ? [geom.coordinates as Pos[][]]
        : geom.type === 'MultiPolygon'
          ? (geom.coordinates as Pos[][][])
          : [];
    for (const polygon of polygons) {
      for (const ring of polygon) traceRing(ctx, ring, project);
    }
  }
}

export function drawTerrainRelief(ctx: CanvasRenderingContext2D, project: Projection['project'], strokeScale = 1) {
  const width = ctx.canvas.width;
  const height = ctx.canvas.height;
  const step = Math.max(2, Math.round(strokeScale * 0.8));
  const lonSpan = EUROPE_RELIEF_BOUNDS.maxLon - EUROPE_RELIEF_BOUNDS.minLon;
  const latSpan = EUROPE_RELIEF_BOUNDS.maxLat - EUROPE_RELIEF_BOUNDS.minLat;
  const reliefLayer = document.createElement('canvas');
  reliefLayer.width = width;
  reliefLayer.height = height;
  const reliefCtx = reliefLayer.getContext('2d');
  if (!reliefCtx) return;

  for (let sy = 0; sy < RELIEF_RASTER.height - step; sy += step) {
    const latNorth = EUROPE_RELIEF_BOUNDS.maxLat - (sy / RELIEF_RASTER.height) * latSpan;
    const latSouth = EUROPE_RELIEF_BOUNDS.maxLat - ((sy + step) / RELIEF_RASTER.height) * latSpan;

    for (let sx = 0; sx < RELIEF_RASTER.width - step; sx += step) {
      const sampleX = Math.min(RELIEF_RASTER.width - 1, sx + Math.floor(step / 2));
      const sampleY = Math.min(RELIEF_RASTER.height - 1, sy + Math.floor(step / 2));
      const idx = (sampleY * RELIEF_RASTER.width + sampleX) * 4;
      const value = RELIEF_RASTER.data[idx] / 255;

      const shadow = clamp((0.74 - value) / 0.34, 0, 1);
      const highlight = clamp((value - 0.72) / 0.18, 0, 1);
      if (shadow < 0.03 && highlight < 0.03) continue;

      const lonWest = EUROPE_RELIEF_BOUNDS.minLon + (sx / RELIEF_RASTER.width) * lonSpan;
      const lonEast = EUROPE_RELIEF_BOUNDS.minLon + ((sx + step) / RELIEF_RASTER.width) * lonSpan;
      const [x1, y1] = project(lonWest, latNorth);
      const [x2, y2] = project(lonEast, latNorth);
      const [x3, y3] = project(lonEast, latSouth);
      const [x4, y4] = project(lonWest, latSouth);

      if (shadow >= 0.03) {
        reliefCtx.fillStyle = `rgba(0,0,0,${0.28 * shadow})`;
        reliefCtx.beginPath();
        reliefCtx.moveTo(x1, y1);
        reliefCtx.lineTo(x2, y2);
        reliefCtx.lineTo(x3, y3);
        reliefCtx.lineTo(x4, y4);
        reliefCtx.closePath();
        reliefCtx.fill();
      }

      if (highlight >= 0.03) {
        reliefCtx.fillStyle = `rgba(255,255,255,${0.14 * highlight})`;
        reliefCtx.beginPath();
        reliefCtx.moveTo(x1, y1);
        reliefCtx.lineTo(x2, y2);
        reliefCtx.lineTo(x3, y3);
        reliefCtx.lineTo(x4, y4);
        reliefCtx.closePath();
        reliefCtx.fill();
      }
    }
  }

  ctx.save();
  ctx.beginPath();
  traceAllLand(ctx, project);
  ctx.clip('evenodd');
  ctx.filter = `blur(${Math.max(2, strokeScale * 0.9)}px)`;
  ctx.drawImage(reliefLayer, 0, 0);
  ctx.filter = 'none';
  ctx.restore();
}

function traceRing(ctx: CanvasRenderingContext2D, ring: Pos[], project: Projection['project']) {
  ring.forEach((pos, i) => {
    const [x, y] = project(pos[0], pos[1]);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.closePath();
}

function traceLine(ctx: CanvasRenderingContext2D, line: Pos[], project: Projection['project']) {
  line.forEach((pos, i) => {
    const [x, y] = project(pos[0], pos[1]);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
}

export function drawOceanBackground(ctx: CanvasRenderingContext2D, width: number, height: number) {
  ctx.fillStyle = COLORS.ocean;
  ctx.fillRect(0, 0, width, height);
}

/**
 * Draws every country as a filled, outlined region using its real (unsimplified-further)
 * border geometry — coastlines and country borders share the same outline, since every
 * country polygon is individually filled+stroked. `strokeScale` lets callers rendering onto
 * a supersampled canvas keep outlines visually the same relative thickness once the image
 * is cropped/scaled back down.
 */
export function drawCountries(ctx: CanvasRenderingContext2D, project: Projection['project'], strokeScale = 1) {
  const { countries } = getEuropeGeoData();
  const reliefByName = getCountryReliefByName();
  for (const f of countries.features) {
    if (!f.geometry) continue;
    const geom = f.geometry as { type: string; coordinates: unknown };
    const polygons: Pos[][][] =
      geom.type === 'Polygon'
        ? [geom.coordinates as Pos[][]]
        : geom.type === 'MultiPolygon'
          ? (geom.coordinates as Pos[][][])
          : [];
    const countryName = f.properties?.name ?? '';
    const reliefMeters = reliefByName.get(countryName) ?? 80;
    const fillColor = countryFillColor(countryName, reliefMeters);
    for (const polygon of polygons) {
      ctx.beginPath();
      for (const ring of polygon) traceRing(ctx, ring, project);
      ctx.fillStyle = fillColor;
      ctx.fill('evenodd');
      ctx.lineJoin = 'round';
      ctx.lineWidth = 2.5 * strokeScale;
      ctx.strokeStyle = COLORS.landStroke;
      ctx.stroke();
    }
  }
}

/** Dashed accent lines along interior country borders (not coastlines). */
export function drawCountryBorders(ctx: CanvasRenderingContext2D, project: Projection['project'], strokeScale = 1) {
  const { borders } = getEuropeGeoData();
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.setLineDash([6 * strokeScale, 6 * strokeScale]);
  ctx.strokeStyle = COLORS.borderDash;
  ctx.lineWidth = 1.5 * strokeScale;
  for (const line of borders.coordinates) {
    ctx.beginPath();
    traceLine(ctx, line, project);
    ctx.stroke();
  }
  ctx.restore();
}


// A handful of hand-picked spots along the Alps arc, purely decorative.
const MOUNTAIN_HINTS: Array<[number, number]> = [
  [6.86, 45.83],
  [7.66, 45.93],
  [8.6, 46.5],
  [9.19, 46.6],
  [10.4, 46.8],
  [10.98, 46.5],
  [11.4, 47.0],
  [12.69, 47.07]
];

export function drawMountainGlyph(ctx: CanvasRenderingContext2D, cx: number, cy: number, scale: number) {
  const s = 30 * scale;
  ctx.save();
  ctx.lineJoin = 'round';
  for (const dx of [-s * 0.62, 0, s * 0.62]) {
    ctx.fillStyle = COLORS.mountain;
    ctx.strokeStyle = COLORS.mountainOutline;
    ctx.lineWidth = 2.4 * scale;
    ctx.beginPath();
    ctx.moveTo(cx + dx - s * 0.58, cy + s * 0.42);
    ctx.lineTo(cx + dx, cy - s * 0.58);
    ctx.lineTo(cx + dx + s * 0.58, cy + s * 0.42);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(cx + dx - s * 0.22, cy - s * 0.16);
    ctx.lineTo(cx + dx, cy - s * 0.58);
    ctx.lineTo(cx + dx + s * 0.22, cy - s * 0.16);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

export function drawMountainHints(
  ctx: CanvasRenderingContext2D,
  project: Projection['project'],
  bounds: LonLatBounds,
  scale = 1
) {
  for (const [lon, lat] of MOUNTAIN_HINTS) {
    if (lon < bounds.minLon || lon > bounds.maxLon || lat < bounds.minLat || lat > bounds.maxLat) continue;
    const [x, y] = project(lon, lat);
    drawMountainGlyph(ctx, x, y, scale);
  }
}

