/** The CJK handwriting font is embedded into main.js at build time. */
export const SKETCH_FONT_FAMILY = "\"BC Sketch Hand\", \"Segoe Print\", cursive";

const FONT_DATA_URL = typeof __BC_SKETCH_FONT_DATA_URL__ === "string" ? __BC_SKETCH_FONT_DATA_URL__ : "";

export const SKETCH_FONT_CSS = FONT_DATA_URL
  ? "@font-face{font-family:\"BC Sketch Hand\";src:url(" + FONT_DATA_URL +
    ") format(\"woff2\");font-style:normal;font-weight:400;font-display:swap;}"
  : "";
