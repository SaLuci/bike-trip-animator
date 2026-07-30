import type { Projection, LonLatBounds } from './types';
import { drawOceanBackground, drawCountries, drawCountryBorders, drawTerrainRelief } from './europeMap';
import { drawCountryLabels, drawRivers, drawLakes, drawSeaLabels } from './geoFeatures';

/**
 * Renders the static basemap (ocean + countries + borders + hydrology + static labels)
 * once into an offscreen canvas. Routes are intentionally NOT baked in here
 * anymore — the camera now pans/zooms during the animation, and route lines stay crisp
 * when redrawn per frame with the current camera projection instead of being cropped out
 * of a pre-rendered bitmap. Cities and mountains are also drawn per frame now so their
 * visibility can react to the zoom state. `strokeScale` should match the supersampling
 * factor used for `width`/`height` relative to the final output canvas.
 */
export function buildBasemapLayer(
  width: number,
  height: number,
  project: Projection['project'],
  bounds: LonLatBounds,
  strokeScale: number
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context is not available.');

  drawOceanBackground(ctx, width, height);
  drawSeaLabels(ctx, project, bounds, strokeScale);
  drawCountries(ctx, project, strokeScale);
  drawTerrainRelief(ctx, project, strokeScale);
  drawCountryBorders(ctx, project, strokeScale);
  drawCountryLabels(ctx, project, strokeScale);
  drawRivers(ctx, project, bounds, strokeScale);
  drawLakes(ctx, project, bounds, strokeScale);

  return canvas;
}

