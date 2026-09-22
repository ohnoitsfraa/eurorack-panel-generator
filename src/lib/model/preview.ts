import type { DecorElement } from '../types';
import { circleRing, roundedRectRing, type Ring } from '../geom/poly';

/**
 * Ring geometry for a shape element.
 *
 * Shared by the 2D editor and the mesh builder so that what is drawn and what
 * is printed cannot drift apart.
 */
export function shapeRingsForPreview(el: Extract<DecorElement, { type: 'shape' }>): Ring[] {
  if (el.shape === 'circle') return [circleRing(el.x, el.y, Math.min(el.w, el.h))];
  const radius = el.shape === 'line' ? Math.min(el.w, el.h) / 2 : el.radius;
  return [roundedRectRing(el.x, el.y, el.w, el.h, radius, el.rotation)];
}
