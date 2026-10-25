/**
 * Pure IPv4 helpers. Addresses are handled as unsigned 32-bit numbers internally.
 * Nothing here assumes a /24: every function takes the real prefix length.
 */

const OCTET = '(25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)';
const IPV4_RE = new RegExp(`^${OCTET}(\\.${OCTET}){3}$`);

export function isValidIPv4(ip: string | null | undefined): ip is string {
  return typeof ip === 'string' && IPV4_RE.test(ip);
}

export function parseIPv4(ip: string): number {
  if (!isValidIPv4(ip)) throw new Error(`IPv4 không hợp lệ: ${ip}`);
  return ip.split('.').reduce((acc, octet) => ((acc << 8) | Number(octet)) >>> 0, 0);
}

export function formatIPv4(n: number): string {
  const v = n >>> 0;
  return [v >>> 24, (v >>> 16) & 255, (v >>> 8) & 255, v & 255].join('.');
}

export function isValidPrefix(prefix: number | null | undefined): prefix is number {
  return typeof prefix === 'number' && Number.isInteger(prefix) && prefix >= 0 && prefix <= 32;
}

export function prefixToMaskInt(prefix: number): number {
  if (!isValidPrefix(prefix)) throw new Error(`Prefix không hợp lệ: ${prefix}`);
  return prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
}

export function prefixToMask(prefix: number): string {
  return formatIPv4(prefixToMaskInt(prefix));
}

/** Returns null for an invalid or non-contiguous mask such as 255.0.255.0. */
export function maskToPrefix(mask: string): number | null {
  if (!isValidIPv4(mask)) return null;
  const n = parseIPv4(mask);
  const inverted = ~n >>> 0;
  // Contiguous masks have an inverted value of the form 2^k - 1.
  if ((inverted & (inverted + 1)) !== 0) return null;
  return 32 - Math.round(Math.log2(inverted + 1));
}

export type Subnet = {
  /** Network address as a number */
  network: number;
  prefix: number;
  /** Broadcast address as a number (equal to network for /32) */
  broadcast: number;
};

export function subnetOf(ip: string, prefix: number): Subnet {
  const mask = prefixToMaskInt(prefix);
  const network = (parseIPv4(ip) & mask) >>> 0;
  return { network, prefix, broadcast: (network | (~mask >>> 0)) >>> 0 };
}

export function networkAddress(ip: string, prefix: number): string {
  return formatIPv4(subnetOf(ip, prefix).network);
}

export function broadcastAddress(ip: string, prefix: number): string {
  return formatIPv4(subnetOf(ip, prefix).broadcast);
}

export function cidrNotation(ip: string, prefix: number): string {
  return `${networkAddress(ip, prefix)}/${prefix}`;
}

export function subnetSize(prefix: number): number {
  return 2 ** (32 - prefix);
}

export function isInSubnet(ip: string, subnet: Subnet): boolean {
  if (!isValidIPv4(ip)) return false;
  const n = parseIPv4(ip);
  return n >= subnet.network && n <= subnet.broadcast;
}

/**
 * First and last address a host may use. /31 (RFC 3021) uses both addresses, /32 the single one;
 * every other prefix excludes the network and broadcast addresses.
 */
export function hostRange(subnet: Subnet): { first: number; last: number } | null {
  if (subnet.prefix === 32) return { first: subnet.network, last: subnet.network };
  if (subnet.prefix === 31) return { first: subnet.network, last: subnet.broadcast };
  if (subnet.broadcast - subnet.network < 2) return null;
  return { first: subnet.network + 1, last: subnet.broadcast - 1 };
}

export function usableHostCount(prefix: number): number {
  if (prefix === 32) return 1;
  if (prefix === 31) return 2;
  return subnetSize(prefix) - 2;
}

export function isNetworkOrBroadcast(ip: string, subnet: Subnet): boolean {
  if (subnet.prefix >= 31) return false;
  const n = parseIPv4(ip);
  return n === subnet.network || n === subnet.broadcast;
}

export function isLinkLocal(ip: string): boolean {
  return isValidIPv4(ip) && ip.startsWith('169.254.');
}

export function compareIPv4(a: string, b: string): number {
  return parseIPv4(a) - parseIPv4(b);
}

/** Every host address of the subnet, in order. Callers must cap the subnet size first. */
export function enumerateHosts(subnet: Subnet): string[] {
  const range = hostRange(subnet);
  if (!range) return [];
  const out: string[] = [];
  for (let n = range.first; n <= range.last; n++) out.push(formatIPv4(n));
  return out;
}

/**
 * When the last octet alone identifies a host (prefix >= 24), the UI can let the technician
 * edit just that octet. Returns the fixed first three octets, or null.
 */
export function fixedPrefixOctets(subnet: Subnet): string | null {
  if (subnet.prefix < 24) return null;
  return formatIPv4(subnet.network).split('.').slice(0, 3).join('.');
}

/** Builds "a.b.c" + last octet; returns null when the octet is not a number 0-255. */
export function composeWithLastOctet(firstThree: string, lastOctet: string): string | null {
  if (!/^\d{1,3}$/.test(lastOctet)) return null;
  const candidate = `${firstThree}.${Number(lastOctet)}`;
  return isValidIPv4(candidate) ? candidate : null;
}
