// Logical drawing size tuned for the app's existing 9:16 layout.
export const CANVAS_WIDTH = 480;
export const CANVAS_HEIGHT = 854;

// Physical export size: the scene is still laid out on the logical canvas above, but the
// final recorded video is rendered at this higher pixel resolution.
export const VIDEO_WIDTH = 1080;
export const VIDEO_HEIGHT = 1920;

// The static basemap (countries/borders/mountains/cities/rivers) is pre-rendered once at
// this multiple of the output size, then cropped+scaled per frame as the camera pans/zooms
// — much cheaper than redrawing ~180 country polygons every single frame.
export const STATIC_SUPERSAMPLE = 2;

// Animation timing (before the speed slider's multiplier is applied): first track today's
// ride zoomed in on its own, a quick "explosion" celebrates today's total, then pull back
// to reveal the whole trip while the remaining planned route draws itself in.
export const FPS = 12;
export const FRAME_DELAY_MS = Math.round(1000 / FPS);
export const TRACK_HOLD_SECONDS = 0.6;
export const ANIMATE_SECONDS = 3.2;
export const EXPLODE_SECONDS = 0.7;
export const ZOOM_OUT_SECONDS = 2.2;
export const END_HOLD_SECONDS = 1.8;

// Animation speed slider bounds/default — a multiplier applied to every *_SECONDS constant
// above (higher = faster/shorter).
export const MIN_SPEED = 0.5;
export const MAX_SPEED = 2.5;
export const DEFAULT_SPEED = 1;

// Camera framing.
export const TRACKING_PADDING = 0.3;
export const FULL_PADDING = 0.14;
export const MIN_TRACKING_SPAN_DEG = 0.25;
export const HEADING_LOOKBACK_KM = 0.4;

// Large context tracks are simplified to at most this many points for per-frame rendering
// (distance math always uses the full-resolution points, only drawing is simplified).
export const RENDER_MAX_POINTS_CONTEXT = 700;

// Cartoon color palette.
export const COLORS = {
  ocean: '#7ec8e3',
  land: ['#bfe3a4', '#b5dd98', '#c9e8ae', '#aedb92'],
  landStroke: '#4f7a3d',
  borderDash: 'rgba(255,255,255,0.8)',
  allDaysRoute: 'rgba(90,98,107,0.85)',
  previousDaysRoute: '#ffa94d',
  currentDayRoute: '#f94144',
  pillBg: 'rgba(255,255,255,0.92)',
  pillText: '#22303c',
  mountain: '#8d99ae',
  mountainOutline: '#33333f'
} as const;

