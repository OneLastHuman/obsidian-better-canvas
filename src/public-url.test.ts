import { describe, expect, it } from "vitest";
import { validatePublicHttpUrl } from "./public-url";

describe("validatePublicHttpUrl", () => {
  it.each([
    "http://localhost/",
    "http://machine.localhost/",
    "http://host.local/",
    "http://127.0.0.1/",
    "http://10.0.0.1/",
    "http://100.64.0.1/",
    "http://172.16.0.1/",
    "http://192.0.0.2/",
    "http://192.168.1.1/",
    "http://192.88.99.1/",
    "http://198.18.0.1/",
    "http://198.51.100.1/",
    "http://203.0.113.1/",
    "http://224.0.0.1/",
    "http://169.254.169.254/",
    "http://[::1]/",
    "http://[::]/",
    "http://[::ffff:127.0.0.1]/",
    "http://[::ffff:7f00:1]/",
    "http://[::ffff:a9fe:a9fe]/",
    "http://[fc00::1]/",
    "http://[fd12:3456::1]/",
    "http://[fe80::1]/",
    "http://[ff02::1]/"
  ])("rejects local or special-use destination %s", input => {
    expect(() => validatePublicHttpUrl(input)).toThrow(/本机或内网地址/);
  });

  it.each([
    "https://example.com/path",
    "http://8.8.8.8/",
    "https://[::ffff:8.8.8.8]/",
    "https://[2606:4700:4700::1111]/"
  ])("allows public HTTP(S) destination %s", input => {
    expect(validatePublicHttpUrl(input).protocol).toMatch(/^https?:$/);
  });

  it("rejects non-HTTP protocols", () => {
    expect(() => validatePublicHttpUrl("file:///etc/passwd")).toThrow(/只支持 http 和 https/);
  });
});
