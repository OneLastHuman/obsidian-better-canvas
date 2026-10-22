const FONT_DATA_URL = typeof __BC_SOFT_NOTES_FONT_DATA_URL__ === "string" ? __BC_SOFT_NOTES_FONT_DATA_URL__ : "";

export const SOFT_NOTES_FONT_CSS = FONT_DATA_URL
  ? '@font-face{font-family:"BC Soft Notes Title";src:url(' + FONT_DATA_URL +
    ') format("woff2");font-style:normal;font-weight:400;font-display:swap;}'
  : "";
