import { expect, test } from "bun:test";
import { isTailnetIPv4 } from "./tailnet-ip.ts";

test("accepts only complete IPv4 addresses in the Tailscale range", () => {
  for (const host of ["100.64.0.1", "100.100.100.100", "100.127.255.254"]) {
    expect(isTailnetIPv4(host)).toBeTrue();
  }
  for (const host of ["100.64.1.2.evil.example", "100.64.1.999", "100.064.1.2", "100.128.1.2", "192.168.1.2", "100.64.1.2."]) {
    expect(isTailnetIPv4(host)).toBeFalse();
  }
});
