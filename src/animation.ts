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
  drawCityMarker,
  drawStatsBar,
  drawDayTitle,
  drawExplosion,
  getRiddenTextAnchor
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
  const basemap = buildBasemapLayer(
    staticWidth,
    staticHeight,
    (lon, lat) => projectWithParams(staticParams, lon, lat),
    staticBounds,
    staticRenderScale
  );
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
  const splitHoldFrames = Math.round((FPS * SPLIT_HOLD_SECONDS) / speed);
  const explodeFrames = Math.max(1, Math.round((FPS * EXPLODE_SECONDS) / speed));
  const preZoomHoldFrames = Math.round((FPS * PRE_ZOOM_HOLD_SECONDS) / speed);
  const zoomOutFrames = Math.max(1, Math.round((FPS * ZOOM_OUT_SECONDS) / speed));
  const endHoldFrames = Math.round((FPS * END_HOLD_SECONDS) / speed);
  const totalFrames = trackHoldFrames + animateFrames + splitHoldFrames + explodeFrames + preZoomHoldFrames + zoomOutFrames + endHoldFrames;

  const recorder = new CanvasVideoRecorder(canvas, FPS);
  const riddenAnchor = getRiddenTextAnchor(CANVAS_WIDTH, CANVAS_HEIGHT, totalTripKm !== null);

  onStatus('Recording animation…');

  // Pre-warm: draw the opening frame ONCE before the recorder starts.
  // This uploads the large basemap texture to the GPU, primes the JS
  // JIT compiler, and warms the font-rendering cache so frame 0 of the
  // actual recording renders at full speed with no cold-start stutter.
  {
    ctx.setTransform(exportScaleX, 0, 0, exportScaleY, 0, 0);
    const warmCrop = cropRectFromCamera(trackingParams, CANVAS_WIDTH, CANVAS_HEIGHT, staticParams);
    ctx.drawImage(basemap, warmCrop.sx, warmCrop.sy, warmCrop.sw, warmCrop.sh, 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    if (startPoint) drawCityMarker(ctx, data.startCity, startPoint, (lon, lat) => projectWithParams(trackingParams, lon, lat), '🚩', CANVAS_WIDTH);
    if (endPoint)   drawCityMarker(ctx, data.endCity,   endPoint,   (lon, lat) => projectWithParams(trackingParams, lon, lat), '🏁', CANVAS_WIDTH);
    drawDayTitle(ctx, data.dayTitle, CANVAS_WIDTH);
  }
  // Give the browser one extra frame-interval to finish any pending GPU
  // work before the encoder starts, then start recording.
  await sleep(FRAME_DELAY_MS);
  recorder.start();
  // One more interval for the MediaRecorder codec to initialise —
  // avoids dropped/duplicate frames at the very beginning of the clip.
  await sleep(FRAME_DELAY_MS);

  // Persists across frames so a near-vertical stretch of road doesn't make the rider flicker.
  let facingLeft = true;
  // Lake labels only appear while camT≈0 (tracking camera). Pre-scope their visibility
  // to that camera's bounds so we don't iterate over all of Europe every frame.
  const lakeLabelBounds = trackingVisibleBounds;

  for (let frameIdx = 0; frameIdx < totalFrames; frameIdx++) {
    const frameStart = performance.now();
    let routeProgress: number;
    let explodeProgress: number;
    let camT: number; // 0 = tracking (zoomed to today), 1 = full tour revealed

    if (frameIdx < trackHoldFrames) {
      routeProgress = 0;
      explodeProgress = 0;
      camT = 0;
    } else if (frameIdx < trackHoldFrames + animateFrames) {
      routeProgress = (frameIdx - trackHoldFrames) / Math.max(1, animateFrames - 1);
      explodeProgress = 0;
      camT = 0;
    } else if (frameIdx < trackHoldFrames + animateFrames + splitHoldFrames) {
      // Hold on the completed route so the viewer can read today's km
      routeProgress = 1;
      explodeProgress = 0;
      camT = 0;
    } else if (frameIdx < trackHoldFrames + animateFrames + splitHoldFrames + explodeFrames) {
      routeProgress = 1;
      explodeProgress = (frameIdx - trackHoldFrames - animateFrames - splitHoldFrames) / Math.max(1, explodeFrames - 1);
      camT = 0;
    } else if (frameIdx < trackHoldFrames + animateFrames + splitHoldFrames + explodeFrames + preZoomHoldFrames) {
      // Hold on the combined total before zooming out
      routeProgress = 1;
      explodeProgress = 1;
      camT = 0;
    } else if (frameIdx < trackHoldFrames + animateFrames + splitHoldFrames + explodeFrames + preZoomHoldFrames + zoomOutFrames) {
      routeProgress = 1;
      explodeProgress = 1;
      camT = easeInOutCubic(
        (frameIdx - trackHoldFrames - animateFrames - splitHoldFrames - explodeFrames - preZoomHoldFrames) / Math.max(1, zoomOutFrames - 1)
      );
    } else {
      routeProgress = 1;
      explodeProgress = 1;
      camT = 1;
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

    if (camT <= 0.02 && startPoint) {
      drawCityMarker(ctx, data.startCity, startPoint, project, '🚩', CANVAS_WIDTH);
    }
    if (routeProgress >= 1 && camT <= 0.02 && endPoint) {
      drawCityMarker(ctx, data.endCity, endPoint, project, '🏁', CANVAS_WIDTH);
    }

    // Drawn after the start/end pins so the rider is always visible on top, even when it
    // ends up sitting at the exact same spot as the end pin.
    if (currentPoint) drawBikeMarker(ctx, currentPoint, project, facingLeft, data.riderEmoji);

    drawDayTitle(ctx, data.dayTitle, CANVAS_WIDTH);

    const todayKm = currentDayKm * routeProgress;
    const riddenKm = previousDaysKm + todayKm;
    const remainingKm = totalTripKm !== null ? totalTripKm - riddenKm : null;
    drawStatsBar(ctx, CANVAS_WIDTH, CANVAS_HEIGHT, previousDaysKm, todayKm, remainingKm, camT, explodeProgress, data.riderEmoji);
    drawExplosion(ctx, riddenAnchor.x, riddenAnchor.y, explodeProgress);

    onProgress((frameIdx + 1) / totalFrames);

    // Real-time pacing: subtract the time already spent rendering so the total frame
    // duration stays at FRAME_DELAY_MS — avoids duplicate captures by the MediaRecorder
    // when rendering is fast, and avoids spiralling delays when it's slow.
    const renderMs = performance.now() - frameStart;
    await sleep(Math.max(0, FRAME_DELAY_MS - renderMs));
  }

  onStatus('Finishing up…');
  return recorder.stop();
}

