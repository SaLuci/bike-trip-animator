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
  ctx.save();
  // Soft shadow for depth
  ctx.shadowColor = 'rgba(0,0,0,0.22)';
  ctx.shadowBlur = 10;
  ctx.shadowOffsetY = 2;
  roundedRectPath(ctx, x - w / 2, y - h / 2, w, h, h / 2);
  ctx.fillStyle = COLORS.pillBg;
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.fillStyle = COLORS.pillText;
  ctx.font = `700 ${fontPx}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y);
  ctx.restore();
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
  // White circle backdrop behind the pin emoji for legibility
  ctx.shadowColor = 'rgba(0,0,0,0.28)';
  ctx.shadowBlur = 10;
  ctx.shadowOffsetY = 2;
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.beginPath();
  ctx.arc(x, y - pinFontPx * 0.48, pinFontPx * 0.58, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
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
  ctx.shadowColor = 'rgba(0,0,0,0.45)';
  ctx.shadowBlur = 10;
  ctx.shadowOffsetY = 2;
  ctx.font = '38px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(emoji, 0, 0);
  ctx.restore();
}

export function drawDayTitle(ctx: CanvasRenderingContext2D, title: string, canvasWidth: number) {
  const trimmed = title.trim();
  if (!trimmed) return;
  const fontPx = 26;
  ctx.save();
  ctx.font = `700 ${fontPx}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  const metrics = ctx.measureText(trimmed);
  const paddingX = fontPx * 0.7;
  const paddingY = fontPx * 0.44;
  const w = metrics.width + paddingX * 2;
  const h = fontPx + paddingY * 2;
  const cx = canvasWidth / 2;
  const cy = 46;
  const r = h / 2;

  // Drop shadow
  ctx.shadowColor = 'rgba(0,0,0,0.32)';
  ctx.shadowBlur = 14;
  ctx.shadowOffsetY = 3;
  // Accent gradient pill
  const grad = ctx.createLinearGradient(cx - w / 2, cy, cx + w / 2, cy);
  grad.addColorStop(0, '#f94144');
  grad.addColorStop(1, '#ff8c42');
  roundedRectPath(ctx, cx - w / 2, cy - h / 2, w, h, r);
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  // White text
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(trimmed, cx, cy);
  ctx.restore();
}


function formatKm(km: number): string {
  return Math.round(km).toLocaleString();
}

const STATS_BAR_HEIGHT = 118;
const STATS_BAR_MARGIN = 20;

/** The on-canvas anchor point of the "km ridden" text, shared with the explosion effect. */
export function getRiddenTextAnchor(
  canvasWidth: number,
  canvasHeight: number,
  hasRemaining: boolean
): { x: number; y: number } {
  const barH = STATS_BAR_HEIGHT;
  const margin = STATS_BAR_MARGIN;
  const y = canvasHeight - margin - barH;
  return {
    x: canvasWidth / 2,
    y: hasRemaining ? y + barH * 0.37 : y + barH * 0.44
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
  const cx = canvasWidth / 2;
  const hasRemaining = remainingKm !== null;

  ctx.save();

  // Background card with shadow
  ctx.shadowColor = 'rgba(0,0,0,0.38)';
  ctx.shadowBlur = 18;
  ctx.shadowOffsetY = 4;
  roundedRectPath(ctx, margin, y, w, barH, 28);
  ctx.fillStyle = 'rgba(8,16,28,0.82)';
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;

  // Frosted-glass top edge
  roundedRectPath(ctx, margin + 1, y + 1, w - 2, 2, 1);
  ctx.fillStyle = 'rgba(255,255,255,0.16)';
  ctx.fill();

  // Vertical centres for the counter and label rows
  const counterCY = hasRemaining ? y + barH * 0.37 : y + barH * 0.44;
  const labelCY   = hasRemaining ? y + barH * 0.64 : y + barH * 0.74;

  const totalRidden = previousKm + todayKm;
  const hasPrevious = previousKm > 0.05;
  const crossfade   = Math.max(0, Math.min(1, splitToCombinedProgress));

  // --- draw a "NNN km" pair centred at (cx, cy) ---
  const drawCounter = (km: number, alpha: number, cy: number) => {
    if (alpha <= 0) return;
    const numFontPx = 52;
    const unitFontPx = 19;
    const numStr = formatKm(km);
    ctx.font = `800 ${numFontPx}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    const numW = ctx.measureText(numStr).width;
    ctx.font = `600 ${unitFontPx}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    const unitW = ctx.measureText(' km').width;
    const pairW = numW + unitW;
    const sx = cx - pairW / 2;

    ctx.globalAlpha = alpha;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';

    ctx.font = `800 ${numFontPx}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    ctx.fillStyle = '#ffffff';
    ctx.fillText(numStr, sx, cy);

    ctx.font = `600 ${unitFontPx}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    ctx.fillStyle = 'rgba(255,255,255,0.60)';
    ctx.fillText(' km', sx + numW, cy + (numFontPx - unitFontPx) * 0.30);
    ctx.globalAlpha = 1;
  };

  // --- draw small label centred at (cx, cy) ---
  const drawLabel = (text: string, alpha: number, cy: number) => {
    if (alpha <= 0) return;
    ctx.globalAlpha = alpha;
    ctx.font = `500 15px system-ui, -apple-system, "Segoe UI", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(255,255,255,0.48)';
    ctx.fillText(text, cx, cy);
    ctx.globalAlpha = 1;
  };

  if (hasPrevious) {
    // Crossfade: today's km → combined total
    drawCounter(todayKm,    1 - crossfade, counterCY);
    drawLabel(`${riderEmoji} today`,  1 - crossfade, labelCY);
    drawCounter(totalRidden, crossfade,     counterCY);
    drawLabel(`${riderEmoji} total`,   crossfade,     labelCY);
  } else {
    drawCounter(todayKm, 1, counterCY);
    drawLabel(`${riderEmoji} total`, 1, labelCY);
  }

  // Remaining km row
  if (remainingKm !== null) {
    const sepY = y + barH * 0.76;
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    ctx.fillRect(margin + 24, sepY, w - 48, 1);

    ctx.font = `500 18px system-ui, -apple-system, "Segoe UI", sans-serif`;
    ctx.fillStyle = 'rgba(255,255,255,0.65)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.globalAlpha = Math.max(0, Math.min(1, remainingAlpha));
    ctx.fillText(`🏁 ${formatKm(remainingKm)} km to go`, cx, y + barH * 0.89);
    ctx.globalAlpha = 1;
  }

  ctx.restore();
}

/**
 * Animated km counter that flies from the stats bar up to the centre of the screen,
 * then smashes the previous total in with a golden flash and shows the combined sum.
 *
 * flyUpT   0→1  number travels from stats-bar to screen-centre (grows 1× → 2.5×)
 * xfade    0→1  smash animation — only runs when flyUpT = 1 and hasPrevious
 */
export function drawCenteredKmCounter(
  ctx: CanvasRenderingContext2D,
  flyUpT: number,
  explodeProgress: number,
  previousKm: number,
  todayKm: number,
  canvasWidth: number,
  canvasHeight: number,
  riderEmoji = '🚴',
  outerAlpha = 1
): void {
  if (flyUpT <= 0 || outerAlpha <= 0) return;

  const easeOut3 = (t: number) => 1 - (1 - clamp(t, 0, 1)) ** 3;
  const flyEased = easeOut3(flyUpT);
  const xfade    = clamp(explodeProgress, 0, 1);
  const hasPrevious = previousKm > 0.05;

  // Vertical position: stats-bar midpoint → 40% down the canvas
  const barCY    = canvasHeight - STATS_BAR_MARGIN - STATS_BAR_HEIGHT * 0.44;
  const targetCY = canvasHeight * 0.40;
  const cy = barCY + (targetCY - barCY) * flyEased;

  // Scale: 1× at bar → 2.5× at centre
  const scale  = 1 + 1.5 * flyEased;
  const nPx    = 52 * scale;   // big number
  const uPx    = 19 * scale;   // ‘km’ unit
  const lPx    = 15 * scale;   // label
  const cx     = canvasWidth / 2;

  ctx.save();

  // --- helper: draw “NNN km” pair centred at (cx, y) ---
  const numPair = (km: number, alpha: number, y: number) => {
    if (alpha * outerAlpha <= 0) return;
    const str = formatKm(km);
    ctx.font = `800 ${nPx}px system-ui,-apple-system,"Segoe UI",sans-serif`;
    const nw = ctx.measureText(str).width;
    ctx.font = `600 ${uPx}px system-ui,-apple-system,"Segoe UI",sans-serif`;
    const uw = ctx.measureText(' km').width;
    const sx = cx - (nw + uw) / 2;
    ctx.globalAlpha = alpha * outerAlpha;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0,0,0,0.50)';
    ctx.shadowBlur  = 18 * scale;
    ctx.font = `800 ${nPx}px system-ui,-apple-system,"Segoe UI",sans-serif`;
    ctx.fillStyle = '#ffffff';
    ctx.fillText(str, sx, y);
    ctx.shadowBlur = 0;
    ctx.font = `600 ${uPx}px system-ui,-apple-system,"Segoe UI",sans-serif`;
    ctx.fillStyle = 'rgba(255,255,255,0.58)';
    ctx.fillText(' km', sx + nw, y + (nPx - uPx) * 0.30);
    ctx.globalAlpha = 1;
  };

  // --- helper: small label centred below the number ---
  const lbl = (text: string, alpha: number, y: number) => {
    if (alpha * outerAlpha <= 0) return;
    ctx.globalAlpha = alpha * outerAlpha;
    ctx.font = `500 ${lPx}px system-ui,-apple-system,"Segoe UI",sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(255,255,255,0.50)';
    ctx.fillText(text, cx, y);
    ctx.globalAlpha = 1;
  };

  if (!hasPrevious) {
    // Single day: number counts up then slides to stats bar. No labels, no flash.
    numPair(todayKm, flyUpT, cy);

  } else if (xfade < 0.25) {
    // SMASH: two numbers converge and fade out into the flash — no overlap.
    const convergeT = easeOut3(xfade / 0.25);
    const fadeOut   = 1 - convergeT;          // both numbers fade as they converge
    const gap = nPx * 0.52;
    const prevY  = cy - gap * (1 - convergeT);
    const todayY = cy + gap * (1 - convergeT);

    // Previous: smaller, gold, fades out
    const pFontPx = nPx * 0.52;
    const pUnitPx = uPx * 0.52;
    const pStr = formatKm(previousKm);
    ctx.font = `700 ${pFontPx}px system-ui,-apple-system,"Segoe UI",sans-serif`;
    const pnw = ctx.measureText(pStr).width;
    ctx.font = `500 ${pUnitPx}px system-ui,-apple-system,"Segoe UI",sans-serif`;
    const puw = ctx.measureText(' km').width;
    const psx = cx - (pnw + puw) / 2;
    ctx.globalAlpha = flyUpT * outerAlpha * fadeOut;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0,0,0,0.45)';
    ctx.shadowBlur = 12;
    ctx.font = `700 ${pFontPx}px system-ui,-apple-system,"Segoe UI",sans-serif`;
    ctx.fillStyle = '#ffd166';
    ctx.fillText(pStr, psx, prevY);
    ctx.shadowBlur = 0;
    ctx.font = `500 ${pUnitPx}px system-ui,-apple-system,"Segoe UI",sans-serif`;
    ctx.fillStyle = 'rgba(255,209,102,0.70)';
    ctx.fillText(' km', psx + pnw, prevY + (pFontPx - pUnitPx) * 0.3);
    ctx.globalAlpha = 1;

    // "+" fades out with the numbers
    const plusY = cy - nPx * 0.12;
    ctx.globalAlpha = flyUpT * outerAlpha * fadeOut;
    ctx.font = `600 ${nPx * 0.38}px system-ui,-apple-system,"Segoe UI",sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff';
    ctx.fillText('+', cx, plusY);
    ctx.globalAlpha = 1;

    // Today: full size, fades out
    numPair(todayKm, flyUpT * fadeOut, todayY);

  } else if (xfade < 0.38) {
    // Flash!
    const flashT = 1 - Math.abs(xfade - 0.315) / 0.065;
    ctx.globalAlpha = clamp(flashT, 0, 1) * 0.80 * outerAlpha;
    ctx.fillStyle = '#ffd166';
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);
    ctx.globalAlpha = 1;

  } else {
    // Combined total — no label — slides to stats bar during zoom-out
    numPair(todayKm + previousKm, flyUpT, cy);
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
