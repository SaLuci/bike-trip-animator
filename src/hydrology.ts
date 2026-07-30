import hydroData from './data/europeHydro10m.json';
import type { LonLatBounds, Projection } from './types';

type HydroPoint = [number, number];

interface RiverInfo {
  name: string;
  scalerank: number;
  lines: HydroPoint[][];
}

interface LakeInfo {
  name: string | null;
  scalerank: number;
  outlines: HydroPoint[][];
}

const RIVERS = hydroData.rivers as RiverInfo[];
const LAKES = hydroData.lakes as LakeInfo[];

const MIN_RIVER_LABEL_LENGTH_PX = 140;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function inBounds(lon: number, lat: number, bounds: LonLatBounds): boolean {
  return lon >= bounds.minLon && lon <= bounds.maxLon && lat >= bounds.minLat && lat <= bounds.maxLat;
}

function traceOpenPath(ctx: CanvasRenderingContext2D, points: HydroPoint[]) {
  if (points.length === 0) return;
  ctx.moveTo(points[0][0], points[0][1]);
  for (let index = 1; index < points.length; index++) {
    const point = points[index];
    ctx.lineTo(point[0], point[1]);
  }
}

function traceClosedPath(ctx: CanvasRenderingContext2D, points: HydroPoint[]) {
  if (points.length === 0) return;
  traceOpenPath(ctx, points);
  ctx.closePath();
}

function polylineLength(points: HydroPoint[]): number {
  let total = 0;
  for (let index = 1; index < points.length; index++) {
    const prev = points[index - 1];
    const curr = points[index];
    total += Math.hypot(curr[0] - prev[0], curr[1] - prev[1]);
  }
  return total;
}

function midpointOfLine(points: HydroPoint[]): HydroPoint {
  if (points.length === 0) return [0, 0];
  if (points.length === 1) return points[0];

  const totalLength = polylineLength(points);
  if (totalLength <= 1e-6) return points[Math.floor(points.length / 2)];

  const target = totalLength / 2;
  let traversed = 0;
  for (let index = 1; index < points.length; index++) {
    const prev = points[index - 1];
    const curr = points[index];
    const segmentLength = Math.hypot(curr[0] - prev[0], curr[1] - prev[1]);
    if (traversed + segmentLength >= target && segmentLength > 1e-6) {
      const segmentT = (target - traversed) / segmentLength;
      return [
        prev[0] + (curr[0] - prev[0]) * segmentT,
        prev[1] + (curr[1] - prev[1]) * segmentT
      ];
    }
    traversed += segmentLength;
  }

  return points[points.length - 1];
}

function ringCentroid(points: HydroPoint[]): { cx: number; cy: number; area: number } {
  let signedArea = 0;
  let centroidX = 0;
  let centroidY = 0;
  const count = points.length;
  for (let index = 0; index < count; index++) {
    const [x0, y0] = points[index];
    const [x1, y1] = points[(index + 1) % count];
    const cross = x0 * y1 - x1 * y0;
    signedArea += cross;
    centroidX += (x0 + x1) * cross;
    centroidY += (y0 + y1) * cross;
  }
  signedArea *= 0.5;
  if (Math.abs(signedArea) < 1e-6) {
    let sumX = 0;
    let sumY = 0;
    for (const [x, y] of points) {
      sumX += x;
      sumY += y;
    }
    return { cx: sumX / count, cy: sumY / count, area: 0 };
  }
  return {
    cx: centroidX / (6 * signedArea),
    cy: centroidY / (6 * signedArea),
    area: Math.abs(signedArea)
  };
}

export function drawRivers(
  ctx: CanvasRenderingContext2D,
  project: Projection['project'],
  bounds: LonLatBounds,
  scale = 1
) {
  ctx.save();
  ctx.strokeStyle = '#5aa9c9';
  ctx.lineWidth = 3 * scale;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.font = `italic 600 ${10 * scale}px system-ui, sans-serif`;
  ctx.textAlign = 'center';

  for (const river of RIVERS) {
    const visibleLines = river.lines.filter((line) => line.some(([lon, lat]) => inBounds(lon, lat, bounds)));
    if (visibleLines.length === 0) continue;

    let longestProjected: HydroPoint[] | null = null;
    let longestLength = 0;
    ctx.beginPath();
    for (const line of visibleLines) {
      const projected = line.map(([lon, lat]) => project(lon, lat) as HydroPoint);
      traceOpenPath(ctx, projected);
      const projectedLength = polylineLength(projected);
      if (projectedLength > longestLength) {
        longestLength = projectedLength;
        longestProjected = projected;
      }
    }
    ctx.stroke();

    if (longestProjected && longestLength >= MIN_RIVER_LABEL_LENGTH_PX * scale) {
      const [midX, midY] = midpointOfLine(longestProjected);
      ctx.fillStyle = '#2b6f8f';
      ctx.fillText(river.name, midX, midY - 10 * scale);
    }
  }
  ctx.restore();
}

export function drawLakes(
  ctx: CanvasRenderingContext2D,
  project: Projection['project'],
  bounds: LonLatBounds,
  scale = 1
) {
  ctx.save();
  ctx.font = `italic 600 ${9 * scale}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.lineWidth = 1.5 * scale;
  ctx.strokeStyle = '#5b8cae';

  for (const lake of LAKES) {
    const visibleOutlines = lake.outlines.filter((outline) => outline.some(([lon, lat]) => inBounds(lon, lat, bounds)));
    if (visibleOutlines.length === 0) continue;

    let largestOutline: HydroPoint[] | null = null;
    let largestArea = 0;
    ctx.fillStyle = '#8fd0e0';
    ctx.beginPath();
    for (const outline of visibleOutlines) {
      const projected = outline.map(([lon, lat]) => project(lon, lat) as HydroPoint);
      traceClosedPath(ctx, projected);
      const centroid = ringCentroid(projected);
      if (centroid.area > largestArea) {
        largestArea = centroid.area;
        largestOutline = projected;
      }
    }
    ctx.fill();
    ctx.stroke();

    if (lake.name && largestOutline) {
      const centroid = ringCentroid(largestOutline);
      const normalizedArea = largestArea / Math.max(1, scale * scale);
      const fontPx = clamp(7.5 + Math.sqrt(normalizedArea) * 0.06, 8, 12) * scale;
      ctx.font = `italic 600 ${fontPx}px system-ui, sans-serif`;
      ctx.lineWidth = Math.max(2 * scale, fontPx * 0.16);
      ctx.strokeStyle = 'rgba(255,255,255,0.88)';
      ctx.strokeText(lake.name, centroid.cx, centroid.cy);
      ctx.fillStyle = '#2b6f8f';
      ctx.fillText(lake.name, centroid.cx, centroid.cy);
    }
  }
  ctx.restore();
}