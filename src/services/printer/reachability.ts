import { isNetworkToolsAvailable, probeHosts, type PortState } from '../../../modules/network-tools';
import type { DiscoveredDevice } from '../../types';

export const WEB_PORTS = [80, 443] as const;
export const PRINTER_PORTS = [9100, 631, 515] as const;

export type Reachability =
  | { state: 'reachable'; openPorts: number[]; webPort: number | null }
  | { state: 'no-route' | 'no-response' | 'unavailable'; reason: string };

/** Pure: turns a TCP probe of the printer into a reachability verdict. */
export function interpretReachability(ports: Record<number, PortState>): Reachability {
  const entries = Object.entries(ports).map(([p, s]) => [Number(p), s] as const);
  const open = entries.filter(([, s]) => s === 'open').map(([p]) => p);
  const answered = entries.some(([, s]) => s === 'open' || s === 'refused');
  if (answered) {
    const webPort = open.includes(80) ? 80 : open.includes(443) ? 443 : null;
    return { state: 'reachable', openPorts: open.sort((a, b) => a - b), webPort };
  }
  if (entries.some(([, s]) => s === 'unreachable')) {
    return {
      state: 'no-route',
      reason: 'Điện thoại không có đường tới IP này (khác subnet và không có router định tuyến, hoặc thiết bị đã tắt).',
    };
  }
  return {
    state: 'no-response',
    reason: 'Máy in không trả lời trong thời gian chờ. Nếu khác subnet, gói tin đi qua gateway và không tới được máy in.',
  };
}

export async function checkReachability(ip: string): Promise<Reachability> {
  if (!isNetworkToolsAvailable) return { state: 'unavailable', reason: 'Thiếu module mạng native.' };
  const [probe] = await probeHosts({ hosts: [ip], ports: [...WEB_PORTS, ...PRINTER_PORTS], timeoutMs: 3000, concurrency: 5 });
  return interpretReachability(probe?.ports ?? {});
}

/** Web admin URL: the advertised adminurl when it points at this IP, else the open web port. */
export function adminUrl(device: Pick<DiscoveredDevice, 'ip' | 'adminUrl'>, reach: Reachability | null): string | null {
  if (device.adminUrl) {
    try {
      const u = new URL(device.adminUrl);
      if (u.hostname === device.ip) return device.adminUrl;
    } catch {
      // ignore malformed TXT value
    }
  }
  if (reach?.state !== 'reachable' || reach.webPort == null) return null;
  return reach.webPort === 443 ? `https://${device.ip}` : `http://${device.ip}`;
}
