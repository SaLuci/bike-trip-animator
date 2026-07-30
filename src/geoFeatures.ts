import type { LonLatBounds, Projection } from './types';
import { getEuropeGeoData, type Pos } from './europeMap';

function inBounds(lon: number, lat: number, bounds: LonLatBounds): boolean {
  return lon >= bounds.minLon && lon <= bounds.maxLon && lat >= bounds.minLat && lat <= bounds.maxLat;
}

// --- Country name labels --------------------------------------------------

/** Standard signed-area polygon centroid formula, applied in projected (pixel) space. */
function ringCentroid(pts: Array<[number, number]>): { cx: number; cy: number; area: number } {
  let area = 0;
  let cx = 0;
  let cy = 0;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[(i + 1) % n];
    const cross = x0 * y1 - x1 * y0;
    area += cross;
    cx += (x0 + x1) * cross;
    cy += (y0 + y1) * cross;
  }
  area *= 0.5;
  if (Math.abs(area) < 1e-6) {
    let sx = 0;
    let sy = 0;
    for (const [x, y] of pts) {
      sx += x;
      sy += y;
    }
    return { cx: sx / n, cy: sy / n, area: 0 };
  }
  return { cx: cx / (6 * area), cy: cy / (6 * area), area: Math.abs(area) };
}

const MIN_COUNTRY_LABEL_AREA_PX = 1400;

/** Writes each country's name centered on its largest landmass, skipping micro-states that would overflow. */
export function drawCountryLabels(ctx: CanvasRenderingContext2D, project: Projection['project'], scale = 1) {
  const { countries } = getEuropeGeoData();
  ctx.save();
  ctx.fillStyle = 'rgba(35,45,35,0.8)';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `700 ${13 * scale}px system-ui, sans-serif`;
  const minArea = MIN_COUNTRY_LABEL_AREA_PX * scale * scale;

  for (const f of countries.features) {
    if (!f.geometry || !f.properties?.name) continue;
    const geom = f.geometry as { type: string; coordinates: unknown };
    const outerRings: Pos[][] =
      geom.type === 'Polygon'
        ? [(geom.coordinates as Pos[][])[0]]
        : geom.type === 'MultiPolygon'
          ? (geom.coordinates as Pos[][][]).map((poly) => poly[0])
          : [];

    let best: { cx: number; cy: number; area: number } | null = null;
    for (const ring of outerRings) {
      const projected = ring.map((pos) => project(pos[0], pos[1]) as [number, number]);
      const c = ringCentroid(projected);
      if (!best || c.area > best.area) best = c;
    }
    if (!best || best.area < minArea) continue;
    ctx.fillText(f.properties.name.toUpperCase(), best.cx, best.cy);
  }
  ctx.restore();
}

// --- Major cities -----------------------------------------------------------

interface CityInfo {
  name: string;
  lon: number;
  lat: number;
}

const MAJOR_CITIES: CityInfo[] = [
  { name: 'Berlin', lon: 13.405, lat: 52.52 },
  { name: 'Munich', lon: 11.582, lat: 48.135 },
  { name: 'Hamburg', lon: 9.993, lat: 53.551 },
  { name: 'Frankfurt', lon: 8.682, lat: 50.11 },
  { name: 'Stuttgart', lon: 9.181, lat: 48.776 },
  { name: 'Vienna', lon: 16.373, lat: 48.208 },
  { name: 'Zurich', lon: 8.541, lat: 47.376 },
  { name: 'Bern', lon: 7.447, lat: 46.948 },
  { name: 'Milan', lon: 9.19, lat: 45.464 },
  { name: 'Rome', lon: 12.496, lat: 41.902 },
  { name: 'Turin', lon: 7.686, lat: 45.07 },
  { name: 'Venice', lon: 12.315, lat: 45.44 },
  { name: 'Naples', lon: 14.268, lat: 40.851 },
  { name: 'Florence', lon: 11.256, lat: 43.769 },
  { name: 'Bologna', lon: 11.343, lat: 44.494 },
  { name: 'Paris', lon: 2.352, lat: 48.857 },
  { name: 'Lyon', lon: 4.835, lat: 45.764 },
  { name: 'Marseille', lon: 5.369, lat: 43.296 },
  { name: 'Madrid', lon: -3.703, lat: 40.417 },
  { name: 'Barcelona', lon: 2.17, lat: 41.385 },
  { name: 'London', lon: -0.128, lat: 51.507 },
  { name: 'Amsterdam', lon: 4.895, lat: 52.37 },
  { name: 'Brussels', lon: 4.351, lat: 50.85 },
  { name: 'Prague', lon: 14.421, lat: 50.088 },
  { name: 'Warsaw', lon: 21.012, lat: 52.23 },
  { name: 'Budapest', lon: 19.04, lat: 47.498 },
  { name: 'Zagreb', lon: 15.977, lat: 45.815 },
  { name: 'Ljubljana', lon: 14.505, lat: 46.056 },
  { name: 'Copenhagen', lon: 12.568, lat: 55.676 },
  { name: 'Stockholm', lon: 18.068, lat: 59.329 },
  { name: 'Oslo', lon: 10.752, lat: 59.913 },
  { name: 'Helsinki', lon: 24.945, lat: 60.192 },
  { name: 'Athens', lon: 23.727, lat: 37.983 },
  { name: 'Lisbon', lon: -9.139, lat: 38.722 },
  { name: 'Dublin', lon: -6.26, lat: 53.349 },
  { name: 'Bratislava', lon: 17.107, lat: 48.148 },
  { name: 'Bucharest', lon: 26.103, lat: 44.427 },
  { name: 'Sofia', lon: 23.322, lat: 42.698 },
  { name: 'Belgrade', lon: 20.457, lat: 44.787 }
];

export function drawCityMarkers(
  ctx: CanvasRenderingContext2D,
  project: Projection['project'],
  bounds: LonLatBounds,
  scale = 1
) {
  ctx.save();
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.font = `600 ${11 * scale}px system-ui, sans-serif`;
  for (const city of MAJOR_CITIES) {
    if (!inBounds(city.lon, city.lat, bounds)) continue;
    const [x, y] = project(city.lon, city.lat);
    ctx.fillStyle = '#2b2b33';
    ctx.beginPath();
    ctx.arc(x, y, 3.2 * scale, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 1.2 * scale;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();

    ctx.fillStyle = 'rgba(30,35,30,0.85)';
    ctx.fillText(city.name, x + 6 * scale, y);
  }
  ctx.restore();
}

// --- Major rivers ------------------------------------------------------------

interface RiverInfo {
  name: string;
  points: Array<[number, number]>;
}

const RIVERS: RiverInfo[] = [
  {
    name: 'Rhine',
    points: [
      [8.7, 47.6],
      [8.2, 47.65],
      [7.6, 47.56],
      [7.7, 48.0],
      [7.75, 48.58],
      [8.0, 49.0],
      [8.27, 49.98],
      [7.5, 50.5],
      [6.96, 50.94],
      [6.1, 51.4],
      [6.11, 51.96],
      [4.48, 51.92]
    ]
  },
  {
    name: 'Danube',
    points: [
      [9.99, 48.4],
      [10.9, 48.7],
      [12.1, 48.94],
      [13.4, 48.6],
      [14.51, 48.31],
      [15.5, 48.3],
      [16.37, 48.21],
      [17.7, 47.8],
      [19.04, 47.5],
      [19.8, 46.3],
      [20.46, 44.82],
      [22.5, 44.3],
      [24.5, 44.2],
      [28.7, 45.2]
    ]
  },
  {
    name: 'Po',
    points: [
      [7.5, 44.98],
      [8.4, 44.9],
      [9.19, 45.07],
      [10.0, 45.05],
      [10.7, 45.0],
      [12.4, 44.9]
    ]
  },
  {
    name: 'Rhone',
    points: [
      [7.0, 46.3],
      [6.6, 46.35],
      [6.15, 46.2],
      [5.4, 46.0],
      [4.835, 45.76],
      [4.8, 44.9],
      [4.8, 43.95],
      [4.7, 43.6],
      [4.6, 43.35]
    ]
  },
  {
    name: 'Elbe',
    points: [
      [14.0, 50.65],
      [13.74, 51.05],
      [12.8, 51.6],
      [12.37, 52.13],
      [11.3, 53.0],
      [9.99, 53.55],
      [8.7, 53.9]
    ]
  },
  {
    name: 'Seine',
    points: [
      [3.5, 48.2],
      [2.9, 48.5],
      [2.35, 48.86],
      [1.6, 49.2],
      [1.08, 49.44],
      [0.27, 49.49]
    ]
  },
  {
    name: 'Ebro',
    points: [
      [-3.5, 43.0],
      [-2.7, 42.7],
      [-1.98, 42.47],
      [-0.5, 42.0],
      [0.87, 41.65],
      [0.85, 40.7]
    ]
  },
  {
    name: 'Tiber',
    points: [
      [12.1, 43.5],
      [12.4, 42.9],
      [12.48, 41.9],
      [12.23, 41.75]
    ]
  }
];

/**
 * Traces an OPEN path through `pts` as a smooth curve instead of sharp straight segments —
 * rivers/lake shores are naturally curvy. `smoothness` (0..1) controls how far each curve's
 * end point sits between the vertex and the next edge's midpoint — 1 is fully rounded
 * (can blur a distinctive silhouette into a generic blob), lower values stay closer to the
 * actual vertices so the real shape still reads clearly.
 */
function traceSmoothOpenPath(ctx: CanvasRenderingContext2D, pts: Array<[number, number]>, smoothness = 0.45) {
  const n = pts.length;
  if (n === 0) return;
  if (n < 3) {
    pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p[0], p[1]) : ctx.lineTo(p[0], p[1])));
    return;
  }
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < n - 1; i++) {
    const curr = pts[i];
    const next = pts[i + 1];
    const anchor: [number, number] = [
      curr[0] + (next[0] - curr[0]) * smoothness,
      curr[1] + (next[1] - curr[1]) * smoothness
    ];
    ctx.quadraticCurveTo(curr[0], curr[1], anchor[0], anchor[1]);
  }
  ctx.lineTo(pts[n - 1][0], pts[n - 1][1]);
}

/** Same idea as `traceSmoothOpenPath` but for a CLOSED shape (lake outlines). */
function traceSmoothClosedPath(ctx: CanvasRenderingContext2D, pts: Array<[number, number]>, smoothness = 0.45) {
  const n = pts.length;
  if (n < 3) return;
  const anchorOf = (a: [number, number], b: [number, number]): [number, number] => [
    a[0] + (b[0] - a[0]) * smoothness,
    a[1] + (b[1] - a[1]) * smoothness
  ];
  const startAnchor = anchorOf(pts[n - 1], pts[0]);
  ctx.moveTo(startAnchor[0], startAnchor[1]);
  for (let i = 0; i < n; i++) {
    const curr = pts[i];
    const next = pts[(i + 1) % n];
    const mid = anchorOf(curr, next);
    ctx.quadraticCurveTo(curr[0], curr[1], mid[0], mid[1]);
  }
  ctx.closePath();
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
    const anyInside = river.points.some(([lon, lat]) => inBounds(lon, lat, bounds));
    if (!anyInside) continue;
    const projected = river.points.map(([lon, lat]) => project(lon, lat) as [number, number]);
    ctx.beginPath();
    traceSmoothOpenPath(ctx, projected);
    ctx.stroke();

    const [midLon, midLat] = river.points[Math.floor(river.points.length / 2)];
    const [mx, my] = project(midLon, midLat);
    ctx.fillStyle = '#2b6f8f';
    ctx.fillText(river.name, mx, my - 10 * scale);
  }
  ctx.restore();
}

// --- Major lakes ---------------------------------------------------------

interface LakeInfo {
  name: string;
  /** Rough real outline (lon/lat), smoothed into a curvy shape when drawn. */
  outline: Array<[number, number]>;
  labelLon: number;
  labelLat: number;
}

const LAKES: LakeInfo[] = [
  {
    name: 'Lake Geneva',
    labelLon: 6.58,
    labelLat: 46.3,
    // Crescent/boomerang shape — tip-hold points near both ends keep them reading as
    // pointed river-mouth tips instead of smoothing into a rounded oval.
    outline: [
      [6.15, 46.21],
      [6.185, 46.228],
      [6.27, 46.285],
      [6.38, 46.355],
      [6.5, 46.43],
      [6.63, 46.5],
      [6.7, 46.51],
      [6.92, 46.4],
      [6.87, 46.385],
      [6.83, 46.36],
      [6.75, 46.3],
      [6.55, 46.25],
      [6.3, 46.22]
    ]
  },
  {
    name: 'Lake Constance',
    labelLon: 9.45,
    labelLat: 47.58,
    outline: [
      [9.17, 47.66],
      [9.25, 47.7],
      [9.35, 47.7],
      [9.45, 47.68],
      [9.55, 47.65],
      [9.75, 47.5],
      [9.6, 47.48],
      [9.4, 47.55],
      [9.28, 47.6]
    ]
  },
  {
    name: 'Lake Garda',
    labelLon: 10.7,
    labelLat: 45.35,
    // Garda's real shape is a narrow fjord-like arm in the north that widens into a much
    // broader basin in the south — the extra points near the tip keep it looking pointed
    // even after corner-smoothing, instead of rounding into a generic uniform blob.
    outline: [
      [10.7, 45.89],
      [10.73, 45.885],
      [10.79, 45.83],
      [10.83, 45.75],
      [10.86, 45.66],
      [10.87, 45.58],
      [10.84, 45.5],
      [10.76, 45.44],
      [10.68, 45.41],
      [10.6, 45.43],
      [10.57, 45.51],
      [10.58, 45.6],
      [10.61, 45.7],
      [10.65, 45.8],
      [10.68, 45.86]
    ]
  },
  {
    name: 'Lake Como',
    labelLon: 9.22,
    labelLat: 45.99,
    // Como's real shape is a distinctive inverted-Y / trident — one arm north to Colico,
    // forking into two southern arms (Como city SW, Lecco SE) with a land peninsula
    // (Triangolo Lariano) poking up between them. Tip-hold points near the 3 arm ends
    // and the peninsula notch keep that branching silhouette after corner-smoothing,
    // instead of rounding into a generic oval blob.
    outline: [
      [9.06, 45.81],
      [9.075, 45.813],
      [9.13, 45.86],
      [9.18, 45.905],
      [9.225, 45.945],
      [9.27, 45.985],
      [9.31, 46.03],
      [9.345, 46.08],
      [9.362, 46.125],
      [9.365, 46.155],
      [9.385, 46.148],
      [9.375, 46.1],
      [9.345, 46.05],
      [9.315, 46.0],
      [9.35, 45.965],
      [9.38, 45.925],
      [9.398, 45.885],
      [9.398, 45.855],
      [9.378, 45.862],
      [9.34, 45.895],
      [9.295, 45.928],
      [9.25, 45.955],
      [9.228, 45.945],
      [9.205, 45.915],
      [9.175, 45.88],
      [9.135, 45.85],
      [9.095, 45.822]
    ]
  },
  {
    name: 'Lake Balaton',
    labelLon: 17.65,
    labelLat: 46.7,
    outline: [
      [17.25, 46.75],
      [17.4, 46.79],
      [17.55, 46.83],
      [17.75, 46.87],
      [17.95, 46.9],
      [18.05, 46.88],
      [17.85, 46.83],
      [17.6, 46.78],
      [17.4, 46.73]
    ]
  }
];

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
    const anyInside = lake.outline.some(([lon, lat]) => inBounds(lon, lat, bounds));
    if (!anyInside) continue;
    const projected = lake.outline.map(([lon, lat]) => project(lon, lat) as [number, number]);
    ctx.fillStyle = '#8fd0e0';
    ctx.beginPath();
    traceSmoothClosedPath(ctx, projected);
    ctx.fill();
    ctx.stroke();

    const [lx, ly] = project(lake.labelLon, lake.labelLat);
    ctx.fillStyle = '#2b6f8f';
    ctx.fillText(lake.name, lx, ly);
  }
  ctx.restore();
}


// --- Sea / ocean name labels (text only, ocean fill already covers the water) ---

interface SeaInfo {
  name: string;
  lon: number;
  lat: number;
}

const SEAS: SeaInfo[] = [
  { name: 'North Sea', lon: 3.8, lat: 56.5 },
  { name: 'Baltic Sea', lon: 18.5, lat: 58.0 },
  { name: 'Mediterranean Sea', lon: 10.5, lat: 38.2 },
  { name: 'Adriatic Sea', lon: 14.8, lat: 42.8 },
  { name: 'Black Sea', lon: 34.0, lat: 43.5 }
];

export function drawSeaLabels(
  ctx: CanvasRenderingContext2D,
  project: Projection['project'],
  bounds: LonLatBounds,
  scale = 1
) {
  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.font = `italic 700 ${13 * scale}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  for (const sea of SEAS) {
    if (!inBounds(sea.lon, sea.lat, bounds)) continue;
    const [x, y] = project(sea.lon, sea.lat);
    ctx.fillText(sea.name.toUpperCase(), x, y);
  }
  ctx.restore();
}
