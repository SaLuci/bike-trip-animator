import type { TrackPoint } from './types';

export class GpxParseError extends Error {}

/** Parses a GPX file's XML text into an ordered list of track points. */
export function parseGpx(xmlText: string, fileName = 'file.gpx'): TrackPoint[] {
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length > 0) {
    throw new GpxParseError(`"${fileName}" is not a valid GPX/XML file.`);
  }

  // Use the namespace wildcard so this works whether or not the file declares
  // a default GPX namespace or uses a namespace prefix.
  const trkpts = doc.getElementsByTagNameNS('*', 'trkpt');
  const points: TrackPoint[] = [];
  for (let i = 0; i < trkpts.length; i++) {
    const el = trkpts[i];
    const lat = parseFloat(el.getAttribute('lat') ?? '');
    const lon = parseFloat(el.getAttribute('lon') ?? '');
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      points.push({ lat, lon });
    }
  }

  if (points.length === 0) {
    throw new GpxParseError(`"${fileName}" does not contain any track points.`);
  }
  return points;
}

export async function parseGpxFile(file: File): Promise<TrackPoint[]> {
  const text = await file.text();
  return parseGpx(text, file.name);
}

/** Sorts files by filename (numeric-aware) so multi-file days concatenate in a sensible order. */
export function sortFilesByName(files: File[]): File[] {
  return [...files].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
  );
}
