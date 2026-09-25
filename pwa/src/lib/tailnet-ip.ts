/** Canonical IPv4 in Tailscale's 100.64.0.0/10 address range. */
export function isTailnetIPv4(host: string): boolean {
  const parts = host.split(".");
  if (parts.length !== 4 || !parts.every(part => /^(0|[1-9][0-9]{0,2})$/.test(part))) return false;
  const octets = parts.map(Number);
  return octets.every(octet => octet <= 255) && octets[0] === 100 && octets[1]! >= 64 && octets[1]! <= 127;
}
