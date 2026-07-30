import lakeLabelsData from './data/euHydroLakeLabels.json';
import type { LonLatBounds, Projection } from './types';
import { EUROPE_RASTER_BOUNDS } from './europeMap';

interface LakeLabelInfo {
  name: string;
  lon: number;
  lat: number;
  area: number;
}

const LAKE_LABELS = lakeLabelsData as LakeLabelInfo[];
let euHydroLakesImage: HTMLImageElement | null = null;

async function loadEuHydroLakesImage() {
  const img = new Image();
  img.decoding = 'async';
  img.src = new URL('./data/euHydroLakes.png', import.meta.url).href;
  await img.decode();
  return img;
}

const euHydroLakesImagePromise = loadEuHydroLakesImage();

export async function ensureHydrologyAssetsLoaded() {
  if (!euHydroLakesImage) euHydroLakesImage = await euHydroLakesImagePromise;
  return euHydroLakesImage;
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
  void ctx;
  void project;
  void bounds;
  void scale;
}

export function drawLakes(
  ctx: CanvasRenderingContext2D,
  project: Projection['project'],
  bounds: LonLatBounds,
  scale = 1
) {
  if (!euHydroLakesImage) return;
  ctx.save();
  const reliefBandHeight = Math.max(2, Math.round(scale * 1.2));
  const lonSpan = EUROPE_RASTER_BOUNDS.maxLon - EUROPE_RASTER_BOUNDS.minLon;
  const latSpan = EUROPE_RASTER_BOUNDS.maxLat - EUROPE_RASTER_BOUNDS.minLat;
  const [dstLeft] = project(EUROPE_RASTER_BOUNDS.minLon, EUROPE_RASTER_BOUNDS.maxLat);
  const [dstRight] = project(EUROPE_RASTER_BOUNDS.maxLon, EUROPE_RASTER_BOUNDS.maxLat);
  ctx.imageSmoothingEnabled = true;

  for (let sy = 0; sy < euHydroLakesImage.height - reliefBandHeight; sy += reliefBandHeight) {
    const latNorth = EUROPE_RASTER_BOUNDS.maxLat - (sy / euHydroLakesImage.height) * latSpan;
    const latSouth = EUROPE_RASTER_BOUNDS.maxLat - ((sy + reliefBandHeight) / euHydroLakesImage.height) * latSpan;
    const [, dstTop] = project(EUROPE_RASTER_BOUNDS.minLon, latNorth);
    const [, dstBottom] = project(EUROPE_RASTER_BOUNDS.minLon, latSouth);
    const destHeight = dstBottom - dstTop;
    if (Math.abs(destHeight) < 0.5) continue;

    ctx.drawImage(
      euHydroLakesImage,
      0,
      sy,
      euHydroLakesImage.width,
      reliefBandHeight,
      dstLeft,
      dstTop,
      dstRight - dstLeft,
      destHeight
    );
  }

  ctx.font = `italic 600 ${9 * scale}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  for (const lake of LAKE_LABELS) {
    if (!inBounds(lake.lon, lake.lat, bounds)) continue;
    const [lx, ly] = project(lake.lon, lake.lat);
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