import { gunzipSync } from "node:zlib";
import { fromArrayBuffer, fromUrl, type GeoTIFFImage } from "geotiff";

export type ChirpsVersion = "3.0" | "2.0";

export type PointRequest = { id: string; longitude: number; latitude: number };

/** CHIRPS marks missing pixels with this sentinel rather than NaN. */
const NODATA = -9999;
/** Any daily/monthly total beyond this is a decoding error, not weather. */
const MAX_PLAUSIBLE_MM = 2000;

const V3_ROOT = "https://data.chc.ucsb.edu/products/CHIRPS/v3.0";
const V2_ROOT = "https://data.chc.ucsb.edu/products/CHIRPS-2.0";

export const CHIRPS_SOURCE_URL = "https://www.chc.ucsb.edu/data/chirps";

const pad = (value: number) => String(value).padStart(2, "0");

export function monthlyUrl(version: ChirpsVersion, year: number, month: number) {
  return version === "3.0"
    ? `${V3_ROOT}/monthly/global/cogs/chirps-v3.0.${year}.${pad(month)}.cog`
    : `${V2_ROOT}/global_monthly/tifs/chirps-v2.0.${year}.${pad(month)}.tif.gz`;
}

/**
 * CHIRPS is natively a pentad product; daily values are downscaled. We use the
 * `rnl` (ERA5-partitioned) series because it spans the whole 1981-present
 * record, unlike `sat` which only starts in 1998.
 */
export function dailyUrl(version: ChirpsVersion, date: string) {
  const [year, month, day] = date.split("-");
  return version === "3.0"
    ? `${V3_ROOT}/daily/final/rnl/${year}/chirps-v3.0.rnl.${year}.${month}.${day}.tif`
    : `${V2_ROOT}/global_daily/tifs/p05/${year}/chirps-v2.0.${year}.${month}.${day}.tif.gz`;
}

function samplePixels(image: GeoTIFFImage, raster: ArrayLike<number>, points: PointRequest[]) {
  const [originX, , , originY] = [
    image.getBoundingBox()[0],
    0,
    0,
    image.getBoundingBox()[3],
  ];
  const [resX, resY] = image.getResolution().map(Math.abs);
  const width = image.getWidth();

  return points.map(point => {
    const x = Math.floor((point.longitude - originX) / resX);
    const y = Math.floor((originY - point.latitude) / resY);
    const value = Number(raster[y * width + x]);
    const valid = Number.isFinite(value) && value > NODATA + 1 && value >= 0 && value < MAX_PLAUSIBLE_MM;
    return { id: point.id, precipitationMm: valid ? value : null };
  });
}

/**
 * Reads one pixel per point out of a remote raster. v3 files are plain/COG
 * GeoTIFFs served with Accept-Ranges, so geotiff fetches only the tiles it
 * needs. v2 files are gzipped, which defeats range reads, so those are pulled
 * in full and inflated locally.
 */
async function readPoints(url: string, points: PointRequest[], signal?: AbortSignal) {
  if (url.endsWith(".gz")) {
    const response = await fetch(url, { signal });
    if (!response.ok) throw new Error(`CHIRPS ${response.status} for ${url}`);
    const inflated = gunzipSync(Buffer.from(await response.arrayBuffer()));
    const tiff = await fromArrayBuffer(
      inflated.buffer.slice(inflated.byteOffset, inflated.byteOffset + inflated.byteLength) as ArrayBuffer
    );
    const image = await tiff.getImage();
    const [raster] = await image.readRasters();
    return samplePixels(image, raster as ArrayLike<number>, points);
  }

  const tiff = await fromUrl(url);
  const image = await tiff.getImage();
  const bbox = image.getBoundingBox();
  const [resX, resY] = image.getResolution().map(Math.abs);

  // Read one small window covering every requested point instead of the globe.
  const xs = points.map(p => Math.floor((p.longitude - bbox[0]) / resX));
  const ys = points.map(p => Math.floor((bbox[3] - p.latitude) / resY));
  const left = Math.max(0, Math.min(...xs));
  const top = Math.max(0, Math.min(...ys));
  const right = Math.min(image.getWidth(), Math.max(...xs) + 1);
  const bottom = Math.min(image.getHeight(), Math.max(...ys) + 1);

  const [window] = (await image.readRasters({
    window: [left, top, right, bottom],
  })) as unknown as ArrayLike<number>[];
  const windowWidth = right - left;

  return points.map((point, index) => {
    const value = Number(window[(ys[index] - top) * windowWidth + (xs[index] - left)]);
    const valid = Number.isFinite(value) && value > NODATA + 1 && value >= 0 && value < MAX_PLAUSIBLE_MM;
    return { id: point.id, precipitationMm: valid ? value : null };
  });
}

export type PointSample = { id: string; precipitationMm: number | null };

/** Tries CHIRPS v3 first and falls back to v2 only if v3 is unavailable. */
export async function readPointsWithFallback(
  buildUrl: (version: ChirpsVersion) => string,
  points: PointRequest[],
  signal?: AbortSignal
): Promise<{ version: ChirpsVersion; samples: PointSample[] }> {
  try {
    return { version: "3.0", samples: await readPoints(buildUrl("3.0"), points, signal) };
  } catch (v3Error) {
    if (signal?.aborted) throw v3Error;
    try {
      return { version: "2.0", samples: await readPoints(buildUrl("2.0"), points, signal) };
    } catch {
      throw v3Error;
    }
  }
}
