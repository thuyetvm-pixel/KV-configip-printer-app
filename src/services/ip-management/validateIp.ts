import type { TargetNetwork } from '../../types';
import {
  isInSubnet,
  isNetworkOrBroadcast,
  isValidIPv4,
  isValidPrefix,
  parseIPv4,
  subnetOf,
} from '../../utils/ipv4';

export type DhcpRange = { start: string; end: string };

/** An address the app has evidence for (scan result, ARP, the technician's own note). */
export type KnownUsage = { ip: string; reason: string };

export type CandidateContext = {
  target: TargetNetwork;
  knownInUse: KnownUsage[];
  dhcpRange?: DhcpRange | null;
  dhcpServer?: string | null;
};

export type IssueCode =
  | 'format'
  | 'reserved'
  | 'outside-subnet'
  | 'network-address'
  | 'broadcast-address'
  | 'phone-ip'
  | 'gateway'
  | 'dhcp-server'
  | 'known-in-use'
  | 'in-dhcp-range';

/**
 * invalid  – the address can never be used here
 * in-use   – the address is confirmed to belong to another device
 * warning  – usable, but the technician should know
 */
export type IssueKind = 'invalid' | 'in-use' | 'warning';

export type ValidationIssue = { code: IssueCode; kind: IssueKind; message: string };

export function isValidDhcpRange(range: DhcpRange | null | undefined): range is DhcpRange {
  return !!range && isValidIPv4(range.start) && isValidIPv4(range.end) && parseIPv4(range.start) <= parseIPv4(range.end);
}

function isReserved(ip: string): boolean {
  const first = Number(ip.split('.')[0]);
  return first === 0 || first === 127 || first >= 224;
}

/** Offline checks: run on every keystroke, no network involved. */
export function validateCandidate(ip: string, ctx: CandidateContext): ValidationIssue[] {
  const ipTrimmed = ip.trim();
  if (!isValidIPv4(ipTrimmed)) {
    return [{ code: 'format', kind: 'invalid', message: 'IPv4 sai định dạng (ví dụ đúng: 192.168.1.201).' }];
  }
  if (isReserved(ipTrimmed)) {
    return [{ code: 'reserved', kind: 'invalid', message: 'Địa chỉ dành riêng (0.x, 127.x, multicast) – không gán cho máy in.' }];
  }

  const { target } = ctx;
  if (!isValidIPv4(target.ipAddress) || !isValidPrefix(target.prefixLength)) {
    return [{ code: 'outside-subnet', kind: 'invalid', message: 'Chưa xác định được subnet đích.' }];
  }
  const subnet = subnetOf(target.ipAddress, target.prefixLength);
  if (!isInSubnet(ipTrimmed, subnet)) {
    return [
      {
        code: 'outside-subnet',
        kind: 'invalid',
        message: `IP nằm ngoài subnet đích ${target.ipAddress}/${target.prefixLength}.`,
      },
    ];
  }

  const issues: ValidationIssue[] = [];
  if (isNetworkOrBroadcast(ipTrimmed, subnet)) {
    const isNetwork = parseIPv4(ipTrimmed) === subnet.network;
    issues.push({
      code: isNetwork ? 'network-address' : 'broadcast-address',
      kind: 'invalid',
      message: isNetwork ? 'Đây là địa chỉ network của subnet.' : 'Đây là địa chỉ broadcast của subnet.',
    });
  }
  if (ipTrimmed === target.ipAddress) {
    issues.push({ code: 'phone-ip', kind: 'in-use', message: 'Trùng IP của điện thoại.' });
  }
  if (target.gateway && ipTrimmed === target.gateway) {
    issues.push({ code: 'gateway', kind: 'in-use', message: 'Trùng địa chỉ gateway (router).' });
  }
  if (ctx.dhcpServer && ipTrimmed === ctx.dhcpServer && ipTrimmed !== target.gateway) {
    issues.push({ code: 'dhcp-server', kind: 'in-use', message: 'Trùng địa chỉ máy chủ DHCP.' });
  }
  for (const usage of ctx.knownInUse) {
    if (usage.ip === ipTrimmed) issues.push({ code: 'known-in-use', kind: 'in-use', message: usage.reason });
  }
  if (isValidDhcpRange(ctx.dhcpRange)) {
    const n = parseIPv4(ipTrimmed);
    if (n >= parseIPv4(ctx.dhcpRange.start) && n <= parseIPv4(ctx.dhcpRange.end)) {
      issues.push({
        code: 'in-dhcp-range',
        kind: 'warning',
        message: `IP nằm trong dải DHCP ${ctx.dhcpRange.start} – ${ctx.dhcpRange.end}: router có thể cấp trùng cho thiết bị khác.`,
      });
    }
  }
  return issues;
}

export function hasIssueOfKind(issues: ValidationIssue[], kind: IssueKind): boolean {
  return issues.some((i) => i.kind === kind);
}
