import { gridDisk, gridDistance, latLngToCell } from 'h3-js';
import type { Coordinates } from '../../../src/domain/jobs/request';

/**
 * Uber's H3 grid: the whole map cut into hexagons, each with an id. A
 * provider's position becomes "which hexagon am I in"; finding providers
 * near a job becomes "who is in these hexagons", a plain indexed lookup
 * instead of measuring the distance to every provider.
 *
 * Why hexagons: every neighbour of a hexagon is the same distance away,
 * so "ring k" (all cells k steps out) is close to a circle of radius
 * k × ~0.9 km at resolution 8. Squares would have corners twice as far.
 */

/**
 * Resolution 8: hexagons ~0.53 km on a side (~0.74 km²), about a
 * neighbourhood. Fixed in code, not a setting: every stored provider cell
 * is at this resolution, so changing it means re-indexing all of them.
 */
export const MATCHING_RESOLUTION = 8;

/**
 * Resolution 6: ~3.7 km on a side (~36 km²), about a district (Kilimani,
 * Westlands). Coarse on purpose: good for "demand in this area" and
 * per-area pricing later, too coarse to point at anyone's home.
 */
export const ZONE_RESOLUTION = 6;

export const matchingCell = ({ lat, lng }: Coordinates) =>
  latLngToCell(lat, lng, MATCHING_RESOLUTION);

export const zoneCell = ({ lat, lng }: Coordinates) =>
  latLngToCell(lat, lng, ZONE_RESOLUTION);

/** Every cell within `ring` steps of `cell`, the cell itself included. */
export const cellsWithin = (cell: string, ring: number) => gridDisk(cell, ring);

/** How many rings apart two cells are (0 = the same cell). */
export const ringsApart = (a: string, b: string) => gridDistance(a, b);

/** Straight-line distance in metres; breaks ties inside a ring. */
export function metresBetween(a: Coordinates, b: Coordinates) {
  const R = 6_371_000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
