import { cidrNotation, enumerateHosts, subnetOf, usableHostCount } from '../../utils/ipv4';

export const SWEEP_PORTS = [9100, 631, 515, 80, 443];
/** Larger subnets are narrowed to the phone's own /24 to keep a sweep under ~20 s. */
export const MAX_SWEEP_HOSTS = 1022;

export type SweepPlan = { hosts: string[]; scope: string; narrowed: boolean };

/** Hosts to TCP-probe: the phone's real subnet, minus the phone itself. */
export function planSweep(phoneIp: string, prefix: number): SweepPlan {
  if (prefix >= 31) return { hosts: [], scope: `/${prefix}`, narrowed: false };
  const narrowed = usableHostCount(prefix) > MAX_SWEEP_HOSTS;
  const effectivePrefix = narrowed ? 24 : prefix;
  const subnet = subnetOf(phoneIp, effectivePrefix);
  const hosts = enumerateHosts(subnet).filter((h) => h !== phoneIp);
  const cidr = cidrNotation(phoneIp, effectivePrefix);
  return {
    hosts,
    scope: narrowed ? `${cidr} (chỉ /24 quanh IP điện thoại – subnet thật là /${prefix})` : cidr,
    narrowed,
  };
}

export function chunk<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}
