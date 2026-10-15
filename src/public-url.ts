const BLOCKED_URL_MESSAGE = "为避免意外访问本机或内网地址，不处理 localhost、私有 IP 或 .local 域名。";

function parseIPv4(host: string): [number, number, number, number] | null {
  const parts = host.split(".");
  if (parts.length !== 4 || parts.some(part => !/^\d{1,3}$/.test(part))) return null;
  const octets = parts.map(Number);
  if (octets.some(part => part < 0 || part > 255)) return null;
  return octets as [number, number, number, number];
}

function isBlockedIPv4(host: string): boolean {
  const ip = parseIPv4(host);
  if (!ip) return false;
  const [a, b, c] = ip;
  return a === 0 || a === 10 || a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2)) || (b === 88 && c === 99))) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224;
}

function parseIPv6(host: string): number[] | null {
  if (!host.startsWith("[") || !host.endsWith("]")) return null;
  const raw = host.slice(1, -1).toLowerCase();
  if (!raw || raw.includes("%")) return null;
  const halves = raw.split("::");
  if (halves.length > 2) return null;
  const parseHalf = (part: string): number[] => {
    if (!part) return [];
    return part.split(":").map(word => {
      if (!/^[0-9a-f]{1,4}$/.test(word)) return NaN;
      return Number.parseInt(word, 16);
    });
  };
  const left = parseHalf(halves[0]);
  const right = parseHalf(halves.length === 2 ? halves[1] : "");
  if ([...left, ...right].some(value => !Number.isFinite(value))) return null;
  if (halves.length === 1) return left.length === 8 ? left : null;
  const missing = 8 - left.length - right.length;
  if (missing < 1) return null;
  return [...left, ...Array(missing).fill(0), ...right];
}

function isBlockedIPv6(host: string): boolean {
  const words = parseIPv6(host);
  if (!words) return false;
  const allZero = words.every(word => word === 0);
  const loopback = words.slice(0, 7).every(word => word === 0) && words[7] === 1;
  if (allZero || loopback) return true;

  // IPv4-mapped IPv6 addresses must be evaluated against the same IPv4 denylist.
  if (words.slice(0, 5).every(word => word === 0) && words[5] === 0xffff) {
    const v4 = [
      words[6] >> 8, words[6] & 0xff, words[7] >> 8, words[7] & 0xff
    ].join(".");
    return isBlockedIPv4(v4);
  }

  const first = words[0];
  // Reject unique-local, link-local, multicast, and non-global/special-use ranges.
  if ((first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80 || (first & 0xff00) === 0xff00) return true;
  if ((first & 0xe000) !== 0x2000) return true;
  // Documentation and 6to4 ranges are not suitable public HTTP destinations.
  if (first === 0x2001 && words[1] === 0x0db8) return true;
  if (first === 0x2002) return true;
  return false;
}

/** Parse an HTTP(S) URL and reject hostnames/IP literals that target local or special-use networks. */
export function validatePublicHttpUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("请输入完整的网页 URL。");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("只支持 http 和 https URL。");
  }
  const host = url.hostname.toLowerCase();
  if (
    host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") ||
    isBlockedIPv4(host) || isBlockedIPv6(host)
  ) {
    throw new Error(BLOCKED_URL_MESSAGE);
  }
  return url;
}
