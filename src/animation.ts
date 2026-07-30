import type { TrackPoint } from './types';
import {
  boundsOfTracks,
  cameraVisibleBounds,
  computeProjectionParams,
  cropRectFromCamera,
  cumulativeDistances,
  downsampleForRender,
  easeInOutCubic,
  expandToMinSpan,
  findNearestDistanceOnTrack,
  lerpProjectionParams,
  progressiveReveal,
  projectWithParams,
  sliceTrackFromDistance,
  trackDistanceKm,
  unionBounds,
  DEFAULT_EUROPE_BOUNDS
} from './geo';
import { buildBasemapLayer } from './baseLayer';
import { ensureHydrologyAssetsLoaded, drawLakeLabelOverlays } from './hydrology';
import {
  drawPolyline,
  drawBikeMarker,
  drawStatsBar,
  drawDayTitle,
  drawExplosion,  drawCenteredKmCounter,  getRiddenTextAnchor
} from './render';
import { CanvasVideoRecorder, type RecordedVideo } from './videoExport';
import { ensureEuropeMapAssetsLoaded } from './europeMap';
import { drawCityOverlays, drawMountainOverlays, selectRouteCityOverlayData } from './geoFeatures';
import {
  CANVAS_WIDTH,
  CANVAS_HEIGHT,
  VIDEO_WIDTH,
  VIDEO_HEIGHT,
  STATIC_SUPERSAMPLE,
  FPS,
  FRAME_DELAY_MS,
  TRACK_HOLD_SECONDS,
  ANIMATE_SECONDS,
  SPLIT_HOLD_SECONDS,
  EXPLODE_SECONDS,
  PRE_ZOOM_HOLD_SECONDS,
  ZOOM_OUT_SECONDS,
  END_HOLD_SECONDS,
  TRACKING_PADDING,
  FULL_PADDING,
  MIN_TRACKING_SPAN_DEG,
  HEADING_LOOKBACK_KM,
  RENDER_MAX_POINTS_CONTEXT,
  COLORS
} from './constants';

export interface TripData {
  previousDaysTracks: TrackPoint[][];
  currentDayPoints: TrackPoint[];
  allDaysTracks: TrackPoint[][];
  startCity: string;
  endCity: string;
  dayTitle: string;
  riderEmoji: string;
}

export interface GenerateOptions {
  canvas: HTMLCanvasElement;
  /** Multiplies the base timing constants; >1 is faster (fewer frames), <1 is slower. */
  speedMultiplier: number;
  onStatus: (message: string) => void;
  onProgress: (fraction: number) => void;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function generateVideo(data: TripData, opts: GenerateOptions): Promise<RecordedVideo> {
  const { canvas, onStatus, onProgress } = opts;
  const speed = Math.max(0.1, opts.speedMultiplier || 1);
  canvas.width = VIDEO_WIDTH;
  canvas.height = VIDEO_HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context is not available.');
  const exportScaleX = VIDEO_WIDTH / CANVAS_WIDTH;
  const exportScaleY = VIDEO_HEIGHT / CANVAS_HEIGHT;
  const staticRenderScale = STATIC_SUPERSAMPLE * Math.max(exportScaleX, exportScaleY);

  const previousDaysKm = data.previousDaysTracks.reduce((sum, t) => sum + trackDistanceKm(t), 0);
  const currentDayKm = trackDistanceKm(data.currentDayPoints);
  const totalTripKm =
    data.allDaysTracks.length > 0 ? data.allDaysTracks.reduce((sum, t) => sum + trackDistanceKm(t), 0) : null;
  const riddenKmFinal = previousDaysKm + currentDayKm;

  // The "full tour" framing — used for the final zoomed-out reveal, and as the fallback
  // camera throughout if there's no current-day route to track.
  const allBoundsTracks =
    data.allDaysTracks.length > 0
      ? data.allDaysTracks
      : [...data.previousDaysTracks, data.currentDayPoints].filter((t) => t.length > 0);
  const fullBounds = boundsOfTracks(allBoundsTracks) ?? DEFAULT_EUROPE_BOUNDS;
  const fullParams = computeProjectionParams(fullBounds, CANVAS_WIDTH, CANVAS_HEIGHT, FULL_PADDING);

  // The "tracking" framing — zoomed to just today's route, with a floor so a very short
  // day doesn't zoom in absurdly tight.
  const hasCurrentRoute = data.currentDayPoints.length >= 2;
  const rawTrackingBounds = hasCurrentRoute ? boundsOfTracks([data.currentDayPoints]) : null;
  const trackingBounds = rawTrackingBounds ? expandToMinSpan(rawTrackingBounds, MIN_TRACKING_SPAN_DEG) : fullBounds;
  const trackingParams = hasCurrentRoute
    ? computeProjectionParams(trackingBounds, CANVAS_WIDTH, CANVAS_HEIGHT, TRACKING_PADDING)
    : fullParams;

  onStatus('Drawing the map…');
  await Promise.all([ensureEuropeMapAssetsLoaded(), ensureHydrologyAssetsLoaded()]);
  // The basemap (countries/rivers/cities/mountains) is pre-rendered once at bounds that
  // cover BOTH the tracking and full-tour framings (a plain fullBounds isn't always enough
  // — e.g. with no previous/all-days data, the padded tracking view can poke outside a tight
  // fullBounds), supersampled so it still looks crisp when the camera crops into it tightly.
  // We union the raw bounds AND the actual canvas-visible geo extent of the tracking camera
  // (which is larger than the raw bounds due to TRACKING_PADDING), so black borders never
  // appear when today's route covers a large geographic area.
  const trackingVisibleBounds = cameraVisibleBounds(trackingParams, CANVAS_WIDTH, CANVAS_HEIGHT);
  const staticBounds = unionBounds(unionBounds(fullBounds, trackingBounds), trackingVisibleBounds);
  const staticWidth = Math.round(CANVAS_WIDTH * STATIC_SUPERSAMPLE * exportScaleX);
  const staticHeight = Math.round(CANVAS_HEIGHT * STATIC_SUPERSAMPLE * exportScaleY);
  const staticParams = computeProjectionParams(staticBounds, staticWidth, staticHeight, FULL_PADDING);
  const basemapCanvas = buildBasemapLayer(
    staticWidth,
    staticHeight,
    (lon, lat) => projectWithParams(staticParams, lon, lat),
    staticBounds,
    staticRenderScale
  );
  // Convert to ImageBitmap so every per-frame drawImage pull comes from GPU memory
  // rather than re-uploading the raw canvas pixels each time (big win on mobile).
  const basemap = await createImageBitmap(basemapCanvas);
  const cityOverlays = selectRouteCityOverlayData(data.currentDayPoints);

  // Route lines are redrawn every frame (so they stay crisp as the camera zooms), but large
  // context tracks are simplified first since their shape barely changes visually. Distance
  // math above already used the full-resolution points.
  const previousDaysRenderTracks = data.previousDaysTracks.map((t) =>
    downsampleForRender(t, RENDER_MAX_POINTS_CONTEXT)
  );

  // Downsample the current day for rendering so per-frame reveal and drawPolyline
  // stay fast regardless of raw GPX file size.
  const currentDayRender = downsampleForRender(data.currentDayPoints, RENDER_MAX_POINTS_CONTEXT);
  const cumDist = cumulativeDistances(currentDayRender);
  const startPoint = data.currentDayPoints[0];
  const endPoint = data.currentDayPoints[data.currentDayPoints.length - 1];

  // The dashed line represents what's left of the trip: the planned route starting from
  // wherever today's ride ends. Today's actual GPS track won't necessarily line up exactly
  // with the planned "All Days" route (different road chosen, GPS drift, etc.), so instead
  // of trusting cumulative distance alone, snap the start to whichever point on the planned
  // route is geographically closest to where today's ride actually ended.
  const allDaysConcatenated = data.allDaysTracks.flat();
  const allDaysCumDist = cumulativeDistances(allDaysConcatenated);
  const remainingStartDistKm =
    hasCurrentRoute && endPoint
      ? findNearestDistanceOnTrack(endPoint, allDaysConcatenated, allDaysCumDist)
      : riddenKmFinal;
  const remainingRouteFull =
    totalTripKm !== null ? sliceTrackFromDistance(allDaysConcatenated, allDaysCumDist, remainingStartDistKm) : [];
  const remainingRouteRender = downsampleForRender(remainingRouteFull, RENDER_MAX_POINTS_CONTEXT);
  const remainingCumDist = cumulativeDistances(remainingRouteRender);
  const hasRemainingRoute = remainingRouteRender.length >= 2;

  const trackHoldFrames = Math.round((FPS * TRACK_HOLD_SECONDS) / speed);
  const animateFrames = Math.max(1, Math.round((FPS * ANIMATE_SECONDS) / speed));
  const splitHoldFrames  = Math.round((FPS * SPLIT_HOLD_SECONDS) / speed);
  // Smash + pre-zoom hold only make sense when there are previous days to add together.
  const hasPreviousDays = previousDaysKm > 0.05;
  const explodeFrames     = hasPreviousDays ? Math.max(1, Math.round((FPS * EXPLODE_SECONDS) / speed)) : 0;
  const preZoomHoldFrames = hasPreviousDays ? Math.round((FPS * PRE_ZOOM_HOLD_SECONDS) / speed) : 0;
  const zoomOutFrames     = Math.max(1, Math.round((FPS * ZOOM_OUT_SECONDS) / speed));
  const endHoldFrames     = Math.round((FPS * END_HOLD_SECONDS) / speed);
  const totalFrames = trackHoldFrames + animateFrames + splitHoldFrames + explodeFrames + preZoomHoldFrames + zoomOutFrames + endHoldFrames;

  const recorder = new CanvasVideoRecorder(canvas, FPS);

  // Persists across frames so a near-vertical stretch of road doesn't make the rider flicker.
  let facingLeft = true;
  // Lake labels only appear while camT≈0 (tracking camera). Pre-scope their visibility
  // to that camera's bounds so we don't iterate over all of Europe every frame.
  const lakeLabelBounds = trackingVisibleBounds;

  // ── PHASE 1: Pre-render every frame to a WebP blob ──────────────────────────
  // Rendering is done at whatever speed the device manages; timing doesn't matter
  // here because the blobs are played back at a locked frame rate in Phase 2.
  onStatus('Pre-rendering frames…');
  const frameBlobs: Blob[] = [];

  for (let frameIdx = 0; frameIdx < totalFrames; frameIdx++) {
    let routeProgress: number;
    let explodeProgress: number;
    let camT: number;

    const A = trackHoldFrames;
    const B = A + animateFrames;
    const C = B + splitHoldFrames;
    const D = C + explodeFrames;
    const E = D + preZoomHoldFrames;
    const F = E + zoomOutFrames;

    if (frameIdx < A) {
      routeProgress = 0; explodeProgress = 0; camT = 0;
    } else if (frameIdx < B) {
      routeProgress = (frameIdx - A) / Math.max(1, animateFrames - 1);
      explodeProgress = 0; camT = 0;
    } else if (frameIdx < C) {
      routeProgress = 1; explodeProgress = 0; camT = 0;
    } else if (frameIdx < D) {
      routeProgress = 1; camT = 0;
      explodeProgress = (frameIdx - C) / Math.max(1, explodeFrames - 1);
    } else if (frameIdx < E) {
      routeProgress = 1; explodeProgress = 1; camT = 0;
    } else if (frameIdx < F) {
      routeProgress = 1; explodeProgress = 1;
      camT = easeInOutCubic((frameIdx - E) / Math.max(1, zoomOutFrames - 1));
    } else {
      routeProgress = 1; explodeProgress = 1; camT = 1;
    }
    routeProgress = Math.max(0, Math.min(1, routeProgress));

    const camParams =
      camT <= 0 ? trackingParams : camT >= 1 ? fullParams : lerpProjectionParams(trackingParams, fullParams, camT);
    const project = (lon: number, lat: number) => projectWithParams(camParams, lon, lat);

    ctx.setTransform(exportScaleX, 0, 0, exportScaleY, 0, 0);
    const crop = cropRectFromCamera(camParams, CANVAS_WIDTH, CANVAS_HEIGHT, staticParams);
    ctx.drawImage(basemap, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    if (hasRemainingRoute) {
      const { revealed: remainingRevealed } = progressiveReveal(remainingRouteRender, remainingCumDist, camT);
      drawPolyline(ctx, remainingRevealed, project, { color: COLORS.allDaysRoute, width: 5, dash: [10, 10], alpha: 0.9 });
    }
    for (const track of previousDaysRenderTracks) {
      drawPolyline(ctx, track, project, { color: COLORS.previousDaysRoute, width: 7 });
    }

    let currentPoint: TrackPoint | null = null;
    if (hasCurrentRoute) {
      const { current, revealed, headingDLon } = progressiveReveal(
        currentDayRender,
        cumDist,
        routeProgress,
        HEADING_LOOKBACK_KM
      );
      if (Math.abs(headingDLon) > 1e-5) facingLeft = headingDLon < 0;
      drawPolyline(ctx, revealed, project, { color: COLORS.currentDayRoute, width: 8 });
      currentPoint = current;
    }

    drawMountainOverlays(ctx, project, camT, CANVAS_WIDTH, CANVAS_HEIGHT);
    drawCityOverlays(ctx, project, cityOverlays, camT, CANVAS_WIDTH, CANVAS_HEIGHT);
    drawLakeLabelOverlays(ctx, project, lakeLabelBounds, camT);

    // Start / end city names — dot on path + bold halo text to the side, fades on zoom-out
    // Drawn before the bike marker so the rider always appears on top
    const drawCityNameText = (label: string, x: number, y: number) => {
      const alpha = Math.max(0, 1 - camT * 8);
      if (alpha <= 0) return;
      const fontPx = 24;
      const dotR = 7;
      const side = x < CANVAS_WIDTH / 2 ? 1 : -1;
      const rawTx = x + side * (dotR + 9);
      const lx = Math.max(fontPx + 4, Math.min(CANVAS_WIDTH - fontPx - 4, rawTx));
      const align: CanvasTextAlign = side > 0 ? 'left' : 'right';

      ctx.save();
      ctx.globalAlpha = alpha;

      ctx.shadowColor = 'rgba(0,0,0,0.35)';
      ctx.shadowBlur = 6;
      ctx.shadowOffsetY = 1;
      ctx.fillStyle = 'rgba(18,26,50,0.92)';
      ctx.beginPath();
      ctx.arc(x, y, dotR, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
      ctx.shadowOffsetY = 0;
      ctx.lineWidth = 2;
      ctx.strokeStyle = 'rgba(255,255,255,0.95)';
      ctx.stroke();

      ctx.font = `800 ${fontPx}px system-ui,-apple-system,"Segoe UI",sans-serif`;
      ctx.textAlign = align;
      ctx.textBaseline = 'middle';
      ctx.lineWidth = Math.max(3, fontPx * 0.28);
      ctx.lineJoin = 'round';
      ctx.strokeStyle = 'rgba(255,255,255,0.95)';
      ctx.strokeText(label, lx, y);
      ctx.fillStyle = 'rgba(18,26,50,0.92)';
      ctx.fillText(label, lx, y);

      ctx.restore();
    };
    if (startPoint && data.startCity.trim()) {
      const [sx, sy] = project(startPoint.lon, startPoint.lat);
      drawCityNameText(data.startCity.trim(), sx, sy);
    }
    if (routeProgress >= 1 && endPoint && data.endCity.trim()) {
      const [ex, ey] = project(endPoint.lon, endPoint.lat);
      drawCityNameText(data.endCity.trim(), ex, ey);
    }

    // Bike marker drawn last so it's always on top of city names
    if (currentPoint) drawBikeMarker(ctx, currentPoint, project, facingLeft, data.riderEmoji);

    drawDayTitle(ctx, data.dayTitle, CANVAS_WIDTH);

    const todayKm = currentDayKm * routeProgress;
    const riddenKm = previousDaysKm + todayKm;
    const remainingKm = totalTripKm !== null ? totalTripKm - riddenKm : null;

    const flyUpT = camT > 0 ? Math.max(0, 1 - camT * 2) : 1;
    drawCenteredKmCounter(ctx, flyUpT, explodeProgress, previousDaysKm, todayKm, CANVAS_WIDTH, CANVAS_HEIGHT, data.riderEmoji, 1);

    const statsBarAlpha = Math.min(1, Math.max(0, (camT - 0.1) / 0.2));
    if (statsBarAlpha > 0.01) {
      ctx.save();
      ctx.globalAlpha = statsBarAlpha;
      drawStatsBar(ctx, CANVAS_WIDTH, CANVAS_HEIGHT, previousDaysKm, todayKm, remainingKm, camT, explodeProgress, data.riderEmoji);
      ctx.restore();
    }

    if (previousDaysKm > 0.05) {
      drawExplosion(ctx, CANVAS_WIDTH / 2, CANVAS_HEIGHT * 0.40, explodeProgress);
    }

    // Snapshot the canvas to a WebP blob (async, but we await before moving on)
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => b ? resolve(b) : reject(new Error('Frame capture failed')),
        'image/webp',
        0.92
      );
    });
    frameBlobs.push(blob);
    onProgress((frameIdx + 1) / totalFrames * 0.8); // 0→80 % during pre-render
    // Yield briefly so the UI stays responsive during the long pre-render
    await sleep(0);
  }

  // ── PHASE 2: Replay at a locked frame rate into the recorder ────────────────
  // Target-time tracking: each captureFrame() is scheduled at its exact wall-clock
  // deadline so that slow frames (e.g. createImageBitmap on mobile) automatically
  // shorten the next sleep, keeping total video duration consistent across devices.
  onStatus('Recording video…');
  await sleep(FRAME_DELAY_MS * 2);
  recorder.start();
  await sleep(FRAME_DELAY_MS);

  const replayStart = performance.now();
  for (let i = 0; i < frameBlobs.length; i++) {
    const bmp = await createImageBitmap(frameBlobs[i]);
    ctx.resetTransform();
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close();
    recorder.captureFrame();
    // Sleep only for whatever time remains until this frame's deadline,
    // so late frames on slow devices don't stretch the video duration.
    const deadline = replayStart + (i + 1) * FRAME_DELAY_MS;
    await sleep(Math.max(0, deadline - performance.now()));
    onProgress(0.8 + (i + 1) / frameBlobs.length * 0.2);
  }

  onStatus('Finishing up…');
  return recorder.stop();
}

