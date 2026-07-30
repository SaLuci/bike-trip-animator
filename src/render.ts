import type { TrackPoint, Projection } from './types';
import { COLORS } from './constants';

export interface StrokeStyleOptions {
  color: string;
  width: number;
  dash?: number[];
  alpha?: number;
}

export function drawPolyline(
  ctx: CanvasRenderingContext2D,
  points: TrackPoint[],
  project: Projection['project'],
  opts: StrokeStyleOptions
) {
  if (points.length < 2) return;
  ctx.save();
  ctx.globalAlpha = opts.alpha ?? 1;
  ctx.strokeStyle = opts.color;
  ctx.lineWidth = opts.width;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.setLineDash(opts.dash ?? []);
  ctx.beginPath();
  points.forEach((p, i) => {
    const [x, y] = project(p.lon, p.lat);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
  ctx.restore();
}

function roundedRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function measureLabelPill(ctx: CanvasRenderingContext2D, text: string, fontPx: number): { w: number; h: number } {
  ctx.font = `700 ${fontPx}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  const metrics = ctx.measureText(text);
  const paddingX = fontPx * 0.6;
  const paddingY = fontPx * 0.42;
  return {
    w: metrics.width + paddingX * 2,
    h: fontPx + paddingY * 2
  };
}

export function drawLabelPill(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, fontPx: number) {
  const { w, h } = measureLabelPill(ctx, text, fontPx);
  roundedRectPath(ctx, x - w / 2, y - h / 2, w, h, h / 2);
  ctx.fillStyle = COLORS.pillBg;
  ctx.fill();
  ctx.fillStyle = COLORS.pillText;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y);
}

export interface CityMarkerLabelOptions {
  slideOutT?: number;
  side?: 'left' | 'right';
}

export function drawCityMarker(
  ctx: CanvasRenderingContext2D,
  label: string,
  point: TrackPoint,
  project: Projection['project'],
  emoji: string,
  canvasWidth: number,
  labelOptions: CityMarkerLabelOptions = {}
) {
  const [x, y] = project(point.lon, point.lat);
  const pinFontPx = 30;
  const slideT = clamp(labelOptions.slideOutT ?? 0, 0, 1);
  const alpha = 1 - slideT;
  if (alpha <= 0.01) return;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font = `${pinFontPx}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText(emoji, x, y);
  ctx.restore();

  if (label && label.trim().length > 0) {
    const trimmed = label.trim();
    const fontPx = 22;
    const { w, h } = measureLabelPill(ctx, trimmed, fontPx);
    const halfW = w / 2;
    const baseX = clamp(x, halfW + 10, canvasWidth - halfW - 10);
    const side = labelOptions.side ?? (x < canvasWidth / 2 ? 'left' : 'right');
    const targetX = side === 'left' ? halfW + 10 : canvasWidth - halfW - 10;
    const labelX = baseX + (targetX - baseX) * slideT;
    const labelY = y - pinFontPx - 14 - 24 * slideT;

    if (slideT > 0.02) {
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = 'rgba(255,255,255,0.72)';
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x, y - pinFontPx * 0.95);
      ctx.lineTo(labelX, labelY + h * 0.35);
      ctx.stroke();
      ctx.restore();
    }

    ctx.save();
    ctx.globalAlpha = alpha;
    drawLabelPill(ctx, trimmed, labelX, labelY, fontPx);
    ctx.restore();
  }
}

export function drawBikeMarker(
  ctx: CanvasRenderingContext2D,
  point: TrackPoint,
  project: Projection['project'],
  facingLeft: boolean,
  emoji = '🚴'
) {
  const [x, y] = project(point.lon, point.lat);
  ctx.save();
  ctx.translate(x, y);
  // Most active-travel emoji face left by default; mirror when heading rightish.
  if (!facingLeft) ctx.scale(-1, 1);
  ctx.shadowColor = 'rgba(0,0,0,0.35)';
  ctx.shadowBlur = 6;
  ctx.font = '34px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(emoji, 0, 0);
  ctx.restore();
}

export function drawDayTitle(ctx: CanvasRenderingContext2D, title: string, canvasWidth: number) {
  const trimmed = title.trim();
  if (!trimmed) return;
  drawLabelPill(ctx, trimmed, canvasWidth / 2, 46, 26);
}


function formatKm(km: number): string {
  return Math.round(km).toLocaleString();
}

const STATS_BAR_HEIGHT = 90;
const STATS_BAR_MARGIN = 24;

/** The on-canvas anchor point of the "km ridden" text, shared with the explosion effect. */
export function getRiddenTextAnchor(
  canvasWidth: number,
  canvasHeight: number,
  hasRemaining: boolean
): { x: number; y: number } {
  const y = canvasHeight - STATS_BAR_MARGIN - STATS_BAR_HEIGHT;
  return {
    x: canvasWidth / 2,
    y: hasRemaining ? y + STATS_BAR_HEIGHT * 0.34 : y + STATS_BAR_HEIGHT / 2
  };
}

export function drawStatsBar(
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
  canvasHeight: number,
  previousKm: number,
  todayKm: number,
  remainingKm: number | null,
  remainingAlpha = 1,
  splitToCombinedProgress = 1,
  riderEmoji = '🚴'
) {
  const barH = STATS_BAR_HEIGHT;
  const margin = STATS_BAR_MARGIN;
  const y = canvasHeight - margin - barH;
  const w = canvasWidth - margin * 2;
  const riddenY = remainingKm !== null ? y + barH * 0.34 : y + barH / 2;

  ctx.save();
  roundedRectPath(ctx, margin, y, w, barH, 24);
  ctx.fillStyle = 'rgba(20,30,40,0.55)';
  ctx.fill();

  ctx.fillStyle = '#ffffff';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';

  const totalRidden = previousKm + todayKm;
  const hasPrevious = previousKm > 0.05;
  const combinedText = `${riderEmoji} ${formatKm(totalRidden)} km ridden`;
  const combinedFontPx = remainingKm !== null ? 26 : 28;

  if (hasPrevious) {
    // Before the "explosion", show the two numbers separately (previous total + today's
    // count-up); the explosion then crossfades into the single combined total.
    const crossfade = Math.max(0, Math.min(1, splitToCombinedProgress));
    const splitText = `${riderEmoji} ${formatKm(previousKm)} + ${formatKm(todayKm)} km ridden`;
    if (crossfade < 1) {
      ctx.font = '700 22px system-ui, sans-serif';
      ctx.globalAlpha = 1 - crossfade;
      ctx.fillText(splitText, canvasWidth / 2, riddenY);
    }
    if (crossfade > 0) {
      ctx.font = `700 ${combinedFontPx}px system-ui, sans-serif`;
      ctx.globalAlpha = crossfade;
      ctx.fillText(combinedText, canvasWidth / 2, riddenY);
    }
    ctx.globalAlpha = 1;
  } else {
    ctx.font = `700 ${combinedFontPx}px system-ui, sans-serif`;
    ctx.fillText(combinedText, canvasWidth / 2, riddenY);
  }

  if (remainingKm !== null) {
    ctx.font = '400 22px system-ui, sans-serif';
    ctx.globalAlpha = Math.max(0, Math.min(1, remainingAlpha));
    ctx.fillText(`🏁 ${formatKm(remainingKm)} km to go`, canvasWidth / 2, y + barH * 0.74);
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

/**
 * A small celebratory particle burst, meant to be centered on (and wide enough to cover)
 * the "km ridden" number right as today's distance finishes counting up — it visually
 * covers the transition from "previous + today" to the single combined total.
 * `progress` runs 0..1 across the effect's duration.
 */
export function drawExplosion(ctx: CanvasRenderingContext2D, cx: number, cy: number, progress: number) {
  const p = Math.max(0, Math.min(1, progress));
  if (p <= 0 || p >= 1) return;

  const numParticles = 14;
  const maxRadius = 60;
  const eased = 1 - (1 - p) ** 3; // ease-out cubic
  const radius = maxRadius * eased;
  const alpha = 1 - p;
  const burstColors = ['#ffd166', '#f94144', '#ffffff'];

  ctx.save();
  for (let i = 0; i < numParticles; i++) {
    const angle = (i / numParticles) * Math.PI * 2 + p * 0.6;
    const x = cx + Math.cos(angle) * radius * 1.4;
    const y = cy + Math.sin(angle) * radius * 0.5;
    const size = Math.max(0.5, 4.5 * (1 - p * 0.6));
    ctx.globalAlpha = alpha;
    ctx.fillStyle = burstColors[i % burstColors.length];
    ctx.beginPath();
    ctx.arc(x, y, size, 0, Math.PI * 2);
    ctx.fill();
  }

  // A quick expanding ring for extra "pop".
  ctx.globalAlpha = alpha * 0.8;
  ctx.strokeStyle = '#ffd166';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.ellipse(cx, cy, radius * 0.9, radius * 0.55, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}
