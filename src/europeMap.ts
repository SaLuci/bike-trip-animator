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

const topology = countries10m as unknown as Topology<{ countries: GeometryObject }>;
const MOUNTAIN_POINTS = mountainData as MountainPointInfo[];

let cachedCountries: GeoFeatureCollection | null = null;
let cachedBorders: GeoMultiLineString | null = null;
let cachedCountryReliefByName: Map<string, number> | null = null;

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

function countryFillColor(name: string, reliefMeters: number): string {
  const reliefT = clamp(Math.log1p(reliefMeters) / Math.log1p(4000), 0, 1);
  const hash = hashStr(name);
  const hue = 88 + (hash % 11) - 5;
  const saturation = clamp(24 + ((hash >>> 4) % 8) - 4 + reliefT * 8, 18, 38);
  const lightness = clamp(88 - reliefT * 18 + (((hash >>> 8) % 7) - 3) * 1.1, 60, 90);
  return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
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

  ctx.save();
  ctx.beginPath();
  traceAllLand(ctx, project);
  ctx.clip('evenodd');

  for (const mountain of MOUNTAIN_POINTS) {
    const [x, y] = project(mountain.lon, mountain.lat);
    const margin = 180 * strokeScale;
    if (x < -margin || x > width + margin || y < -margin || y > height + margin) continue;

    const elevationT = clamp((mountain.elevation - 400) / 3600, 0, 1);
    const rotation = (((hashStr(mountain.name) >>> 0) % 180) - 90) * (Math.PI / 180);
    const outerRadius = (44 + elevationT * 150) * strokeScale;
    const coreRadius = outerRadius * (0.24 + elevationT * 0.08);
    const stretch = 1.45 + elevationT * 0.7;

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rotation);
    ctx.scale(stretch, 0.9);
    ctx.globalCompositeOperation = 'multiply';
    const shadow = ctx.createRadialGradient(0, -outerRadius * 0.14, coreRadius * 0.18, 0, 0, outerRadius);
    shadow.addColorStop(0, 'rgba(128, 78, 36, 0.32)');
    shadow.addColorStop(0.42, 'rgba(145, 94, 48, 0.18)');
    shadow.addColorStop(1, 'rgba(145, 94, 48, 0)');
    ctx.fillStyle = shadow;
    ctx.beginPath();
    ctx.arc(0, 0, outerRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.translate(x + outerRadius * 0.1, y + outerRadius * 0.06);
    ctx.rotate(rotation + 0.14);
    ctx.scale(1 + elevationT * 0.35, 0.62);
    ctx.globalCompositeOperation = 'multiply';
    const core = ctx.createRadialGradient(0, -coreRadius * 0.12, coreRadius * 0.1, 0, 0, coreRadius);
    core.addColorStop(0, 'rgba(110, 63, 28, 0.28)');
    core.addColorStop(0.55, 'rgba(124, 77, 37, 0.16)');
    core.addColorStop(1, 'rgba(124, 77, 37, 0)');
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(0, 0, coreRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.translate(x - outerRadius * 0.18, y - outerRadius * 0.16);
    ctx.rotate(rotation - 0.18);
    ctx.scale(stretch * 0.9, 0.8);
    ctx.globalCompositeOperation = 'screen';
    const highlight = ctx.createRadialGradient(0, 0, 0, 0, 0, outerRadius * 0.85);
    highlight.addColorStop(0, 'rgba(255, 245, 220, 0.18)');
    highlight.addColorStop(0.45, 'rgba(255, 245, 220, 0.06)');
    highlight.addColorStop(1, 'rgba(255, 245, 220, 0)');
    ctx.fillStyle = highlight;
    ctx.beginPath();
    ctx.arc(0, 0, outerRadius * 0.85, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

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

