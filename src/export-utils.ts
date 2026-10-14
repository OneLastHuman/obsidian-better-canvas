/**
 * Scale the intrinsic SVG dimensions while keeping its viewBox unchanged.
 * The SVG stays vector-based; increasing width/height gives rasterizers a
 * predictable higher-resolution target when the export is opened elsewhere.
 */
export function scaleSvgIntrinsicDimensions(svg: string, scale: number): string {
  if (!Number.isFinite(scale) || scale < 1 || scale > 4) {
    throw new Error("SVG scale must be between 1x and 4x.");
  }
  const root = svg.match(/<svg\b([^>]*)>/i);
  if (!root) throw new Error("The exported data does not contain an SVG root element.");
  if (scale === 1) return svg;

  let attributes = root[1];
  const viewBoxRaw = attributes.match(/(?:^|\s)viewBox\s*=\s*(["'])(.*?)\1/i)?.[2];
  const viewBoxValues = viewBoxRaw?.trim().split(/[\s,]+/).map(Number);
  const fallbackWidth = viewBoxValues?.length === 4 && Number.isFinite(viewBoxValues[2]) ? viewBoxValues[2] : NaN;
  const fallbackHeight = viewBoxValues?.length === 4 && Number.isFinite(viewBoxValues[3]) ? viewBoxValues[3] : NaN;

  const scaleDimension = (name: "width" | "height", fallback: number): void => {
    const attribute = new RegExp("(^|\\\\s)" + name + "\\\\s*=\\\\s*([\\"'])([^\\"']*)\\\\2", "i");
    const match = attributes.match(attribute);
    const raw = match?.[3] ?? "";
    const numeric = raw.match(/^([0-9]+(?:\.[0-9]+)?)(px|pt|pc|mm|cm|in)?$/i);
    const value = numeric ? Number(numeric[1]) : fallback;
    if (!Number.isFinite(value) || value <= 0) return;
    const unit = numeric?.[2] ?? "px";
    const quote = match?.[2] ?? '"';
    const prefix = match?.[1] ?? " ";
    const replacement = prefix + name + "=" + quote + String(Number((value * scale).toFixed(3))) + unit + quote;
    if (match) attributes = attributes.replace(match[0], replacement);
    else attributes += " " + name + "=" + quote + String(Number((value * scale).toFixed(3))) + "px" + quote;
  };

  scaleDimension("width", fallbackWidth);
  scaleDimension("height", fallbackHeight);
  const newRoot = "<svg" + attributes + ">";
  return svg.replace(root[0], newRoot);
}
