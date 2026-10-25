import { formatIPv4, hostRange, isValidIPv4, isValidPrefix, parseIPv4, subnetOf } from '../../utils/ipv4';
import { hasIssueOfKind, validateCandidate, type CandidateContext } from './validateIp';

/** Easy-to-remember host numbers, tried first inside the phone's /24 block. */
export const PREFERRED_LAST_OCTETS = [
  200, 201, 202, 203, 204, 205, 206, 207, 208, 209, 210, 220, 230, 240, 250, 150, 100,
];

export type IpSuggestion = {
  ip: string;
  /** true when the address sits inside the known DHCP range (only offered when nothing else is free) */
  inDhcpRange: boolean;
};

export type SuggestResult = { suggestions: IpSuggestion[]; reason?: string };

/**
 * Candidate order:
 *  1. preferred octets (.200, .201 … .250, .150, .100) within the /24 block containing the phone,
 *     when that block lies inside the target subnet (prefix <= 24);
 *  2. every other host, from the top of the subnet downwards (low addresses are usually DHCP).
 * Each candidate goes through validateCandidate; addresses inside the DHCP range are used only
 * as a last resort. `exclude` holds addresses already rejected by a network check.
 */
export function suggestIps(ctx: CandidateContext, opts: { count?: number; exclude?: string[] } = {}): SuggestResult {
  const count = opts.count ?? 5;
  const { target } = ctx;
  if (!isValidIPv4(target.ipAddress) || !isValidPrefix(target.prefixLength)) {
    return { suggestions: [], reason: 'Chưa xác định được IP/prefix của mạng đích.' };
  }
  const subnet = subnetOf(target.ipAddress, target.prefixLength);
  const range = hostRange(subnet);
  if (!range || target.prefixLength >= 31) {
    return { suggestions: [], reason: `Subnet /${target.prefixLength} không còn địa chỉ trống cho máy in.` };
  }

  const excluded = new Set((opts.exclude ?? []).filter(isValidIPv4));
  const ordered: number[] = [];
  const seen = new Set<number>();
  const push = (n: number) => {
    if (n < range.first || n > range.last || seen.has(n)) return;
    seen.add(n);
    ordered.push(n);
  };

  if (target.prefixLength <= 24) {
    const block = (parseIPv4(target.ipAddress) & 0xffffff00) >>> 0;
    PREFERRED_LAST_OCTETS.forEach((o) => push(block + o));
  }
  // Cap the walk so a /8 does not enumerate 16 million addresses.
  const limit = Math.min(range.last - range.first + 1, 65536);
  for (let i = 0; i < limit; i++) push(range.last - i);

  const clean: IpSuggestion[] = [];
  const dhcp: IpSuggestion[] = [];
  for (const n of ordered) {
    const ip = formatIPv4(n);
    if (excluded.has(ip)) continue;
    const issues = validateCandidate(ip, ctx);
    if (hasIssueOfKind(issues, 'invalid') || hasIssueOfKind(issues, 'in-use')) continue;
    if (issues.some((i) => i.code === 'in-dhcp-range')) {
      if (dhcp.length < count) dhcp.push({ ip, inDhcpRange: true });
      continue;
    }
    clean.push({ ip, inDhcpRange: false });
    if (clean.length >= count) break;
  }

  const suggestions = [...clean, ...dhcp].slice(0, count);
  if (suggestions.length === 0) return { suggestions, reason: 'Không còn địa chỉ hợp lệ chưa bị chiếm trong subnet.' };
  return { suggestions };
}
