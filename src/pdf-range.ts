/**
 * Parse user-entered PDF page selections such as "1-3, 5, 8-10".
 * Returns unique page numbers in ascending order and rejects overly large
 * selections before any expensive PDF rendering or AI request begins.
 */
import { t } from "./i18n";

export function parsePdfPageSelection(
  raw: string,
  maxPages = 20,
  maxPageNumber = 10000
): number[] {
  const input = raw.trim();
  if (!input) throw new Error(t("Enter page numbers or ranges, e.g. 1-5.", "请输入页码或页码范围，例如 1-5。"));
  if (!Number.isInteger(maxPages) || maxPages < 1) throw new Error(t("Invalid page limit.", "最大页数限制无效。"));

  const selected = new Set<number>();
  for (const segment of input.split(",")) {
    const match = segment.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/);
    if (!match) throw new Error(t("Invalid page format. Use 3, 1-5, or 1-3,5,8-10.", "页码格式无效。请使用 3、1-5 或 1-3,5,8-10。"));

    const start = Number(match[1]);
    const end = match[2] === undefined ? start : Number(match[2]);
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) ||
        start < 1 || end < start || end > maxPageNumber) {
      throw new Error(t("Pages must be a valid range of positive integers between 1 and " + maxPageNumber + ".",
        "页码必须是 1 至 " + maxPageNumber + " 之间的有效正整数范围。"));
    }

    for (let page = start; page <= end; page++) {
      selected.add(page);
      if (selected.size > maxPages) {
        throw new Error(t("At most " + maxPages + " pages per request; split the selection into batches.",
          "每次最多处理 " + maxPages + " 页，请拆分成多个批次。"));
      }
    }
  }

  return [...selected].sort((a, b) => a - b);
}
