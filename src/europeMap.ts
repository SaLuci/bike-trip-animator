import * as topojson from 'topojson-client';
import countries110m from 'world-atlas/countries-110m.json';
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

const topology = countries110m as unknown as Topology<{ countries: GeometryObject }>;

let cachedCountries: GeoFeatureCollection | null = null;
let cachedBorders: GeoMultiLineString | null = null;

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

/** Small deterministic hash so each country gets a consistent (but varied) land color. */
function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
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
  for (const f of countries.features) {
    if (!f.geometry) continue;
    const geom = f.geometry as { type: string; coordinates: unknown };
    const polygons: Pos[][][] =
      geom.type === 'Polygon'
        ? [geom.coordinates as Pos[][]]
        : geom.type === 'MultiPolygon'
          ? (geom.coordinates as Pos[][][])
          : [];
    const colorIdx = hashStr(f.properties?.name ?? '') % COLORS.land.length;
    for (const polygon of polygons) {
      ctx.beginPath();
      for (const ring of polygon) traceRing(ctx, ring, project);
      ctx.fillStyle = COLORS.land[colorIdx];
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

function drawMountainGlyph(ctx: CanvasRenderingContext2D, cx: number, cy: number, scale: number) {
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

