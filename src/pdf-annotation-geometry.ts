export interface PdfNormalizedPoint {
  x: number;
  y: number;
}

interface PixelPoint {
  x: number;
  y: number;
}

interface Segment {
  a: PixelPoint;
  b: PixelPoint;
}

function toPixels(point: PdfNormalizedPoint, width: number, height: number): PixelPoint {
  return {
    x: Math.max(0, Math.min(1, point.x)) * Math.max(1, width),
    y: Math.max(0, Math.min(1, point.y)) * Math.max(1, height)
  };
}

function pointSegmentDistance(point: PixelPoint, start: PixelPoint, end: PixelPoint): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= 1e-12) return Math.hypot(point.x - start.x, point.y - start.y);
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
  return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
}

function cross(a: PixelPoint, b: PixelPoint, c: PixelPoint): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function withinBounds(point: PixelPoint, a: PixelPoint, b: PixelPoint): boolean {
  const epsilon = 1e-8;
  return point.x >= Math.min(a.x, b.x) - epsilon &&
    point.x <= Math.max(a.x, b.x) + epsilon &&
    point.y >= Math.min(a.y, b.y) - epsilon &&
    point.y <= Math.max(a.y, b.y) + epsilon;
}

function segmentsIntersect(a: PixelPoint, b: PixelPoint, c: PixelPoint, d: PixelPoint): boolean {
  const abC = cross(a, b, c);
  const abD = cross(a, b, d);
  const cdA = cross(c, d, a);
  const cdB = cross(c, d, b);
  const epsilon = 1e-8;

  if (((abC > epsilon && abD < -epsilon) || (abC < -epsilon && abD > epsilon)) &&
      ((cdA > epsilon && cdB < -epsilon) || (cdA < -epsilon && cdB > epsilon))) return true;
  if (Math.abs(abC) <= epsilon && withinBounds(c, a, b)) return true;
  if (Math.abs(abD) <= epsilon && withinBounds(d, a, b)) return true;
  if (Math.abs(cdA) <= epsilon && withinBounds(a, c, d)) return true;
  if (Math.abs(cdB) <= epsilon && withinBounds(b, c, d)) return true;
  return false;
}

function segmentDistance(left: Segment, right: Segment): number {
  if (segmentsIntersect(left.a, left.b, right.a, right.b)) return 0;
  return Math.min(
    pointSegmentDistance(left.a, right.a, right.b),
    pointSegmentDistance(left.b, right.a, right.b),
    pointSegmentDistance(right.a, left.a, left.b),
    pointSegmentDistance(right.b, left.a, left.b)
  );
}

function polylineSegments(points: PixelPoint[]): Segment[] {
  if (points.length === 1) return [{ a: points[0], b: points[0] }];
  const result: Segment[] = [];
  for (let index = 1; index < points.length; index++) {
    result.push({ a: points[index - 1], b: points[index] });
  }
  return result;
}

/**
 * Determine whether a saved annotation stroke touches the eraser path.
 * Geometry is compared in rendered page pixels, including the case where two
 * long segments cross between their recorded pointer samples.
 */
export function strokeTouchesEraser(
  strokePoints: PdfNormalizedPoint[],
  eraserPoints: PdfNormalizedPoint[],
  pageWidth: number,
  pageHeight: number,
  tolerancePixels = 22
): boolean {
  if (!strokePoints.length || !eraserPoints.length ||
      !Number.isFinite(pageWidth) || !Number.isFinite(pageHeight) ||
      !Number.isFinite(tolerancePixels) || tolerancePixels < 0) return false;

  const stroke = polylineSegments(strokePoints.map(point => toPixels(point, pageWidth, pageHeight)));
  const eraser = polylineSegments(eraserPoints.map(point => toPixels(point, pageWidth, pageHeight)));
  for (const left of stroke) {
    for (const right of eraser) {
      if (segmentDistance(left, right) <= tolerancePixels) return true;
    }
  }
  return false;
}
