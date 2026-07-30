export interface TrackPoint {
  lat: number;
  lon: number;
}

export interface LonLatBounds {
  minLon: number;
  maxLon: number;
  minLat: number;
  maxLat: number;
}

export interface Projection {
  project(lon: number, lat: number): [number, number];
}
