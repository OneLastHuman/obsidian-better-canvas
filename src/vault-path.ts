/** Join vault-relative path fragments without introducing leading, trailing, or duplicate separators. */
export function joinVaultPath(...parts: Array<string | null | undefined>): string {
  return parts
    .map(part => String(part ?? "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "").replace(/\/+/g, "/"))
    .filter(Boolean)
    .join("/");
}
