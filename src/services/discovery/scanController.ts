import {
  acquireMulticastLock,
  isNetworkToolsAvailable,
  probeHosts,
  readArpTable,
  releaseMulticastLock,
} from '../../../modules/network-tools';
import type { DiscoveredDevice, PhoneNetwork, ScanErrorCode, ScanProgress } from '../../types';
import { broadcastAddress, isValidIPv4 } from '../../utils/ipv4';
import { networkChanged, scanPreflight } from '../network/buildPhoneNetwork';
import { readPhoneNetwork, watchNetwork } from '../network/phoneNetwork';
import { discoverSnmpDevices } from '../printer/snmp/snmpClient';
import { applyObservation, sortDevices, type Observation } from './deviceStore';
import { startMdnsScan } from './mdns';
import { probeAddress } from './probeAddress';
import { chunk, planSweep, SWEEP_PORTS } from './sweepPlan';

const MDNS_MIN_MS = 12000;
const SWEEP_CHUNK = 64;
const SWEEP_TIMEOUT_MS = 700;
const SWEEP_CONCURRENCY = 96;

export type ScanOutcome = {
  status: 'done' | 'cancelled' | 'error';
  error?: { code: ScanErrorCode; message: string };
  devices: DiscoveredDevice[];
  notes: string[];
};

export type ScanCallbacks = {
  onDevices: (devices: DiscoveredDevice[]) => void;
  onProgress: (p: ScanProgress) => void;
  onLog: (message: string) => void;
};

export type ScanHandle = { cancel: () => void; done: Promise<ScanOutcome> };

/**
 * Runs every discovery method the phone can do without root, at the same time where possible:
 *  - mDNS/NSD for the whole scan (finds printers on the same L2/VLAN, any subnet)
 *  - SNMP GET broadcast (answers only if the device can route back to the phone)
 *  - TCP connect sweep of the phone's subnet on printer/web ports
 *  - re-probe of addresses the technician entered
 *  - /proc/net/arp on Android 9 and older
 */
export function startScan(net: PhoneNetwork, manualIps: string[], cb: ScanCallbacks): ScanHandle {
  const devices = new Map<string, DiscoveredDevice>();
  const notes: string[] = [];
  let finished = false;
  let resolveOutcome!: (o: ScanOutcome) => void;
  const done = new Promise<ScanOutcome>((r) => (resolveOutcome = r));

  const emit = () => cb.onDevices(sortDevices([...devices.values()]));
  const observe = (obs: Observation) => {
    if (finished) return;
    if (obs.ip === net.ipAddress) return;
    if (applyObservation(devices, obs)) emit();
  };

  let stopMdns: () => void = () => {};
  let unwatch: () => void = () => {};

  const finish = (status: ScanOutcome['status'], error?: ScanOutcome['error']) => {
    if (finished) return;
    finished = true;
    stopMdns();
    unwatch();
    releaseMulticastLock();
    cb.onProgress({
      phase: status === 'done' ? 'done' : status === 'cancelled' ? 'cancelled' : 'error',
      fraction: 1,
      message: error?.message ?? (status === 'cancelled' ? 'Đã dừng quét.' : 'Hoàn tất.'),
    });
    resolveOutcome({ status, error, devices: sortDevices([...devices.values()]), notes });
  };

  const preflight = scanPreflight(net);
  if (!preflight.canScan) {
    const b = preflight.blockers[0];
    const code: ScanErrorCode = b.code === 'no-prefix' ? 'no-ip' : b.code;
    finish('error', { code, message: preflight.blockers.map((x) => x.message).join(' ') });
    return { cancel: () => {}, done };
  }
  preflight.warnings.forEach(cb.onLog);

  // Network switched mid-scan (Wi-Fi dropped, roamed to another SSID, DHCP renewed with a new IP).
  unwatch = watchNetwork(() => {
    readPhoneNetwork()
      .then((now) => {
        if (!finished && networkChanged(net, now)) {
          finish('error', { code: 'network-changed', message: 'Mạng của điện thoại đã thay đổi trong lúc quét. Kết quả có thể không đầy đủ – hãy quét lại.' });
        }
      })
      .catch(() => {});
  });

  const run = async () => {
    const started = Date.now();
    const lock = acquireMulticastLock();
    cb.onLog(lock ? 'Đã bật Wi-Fi MulticastLock cho mDNS.' : 'Không giữ được MulticastLock – mDNS có thể bị chip Wi-Fi lọc.');

    cb.onProgress({ phase: 'mdns', fraction: 0.02, message: 'Đang nghe mDNS/Bonjour…' });
    stopMdns = startMdnsScan({ onObservation: observe, onError: cb.onLog });

    const ip = net.ipAddress!;
    const prefix = net.prefixLength!;
    const broadcasts = ['255.255.255.255'];
    if (prefix < 31) broadcasts.push(broadcastAddress(ip, prefix));
    const snmp = discoverSnmpDevices({ broadcastAddresses: broadcasts, timeoutMs: 4000 })
      .then((list) => {
        list.forEach((d) => observe({ method: 'snmp', ...d }));
        cb.onLog(`SNMP broadcast: ${list.length} thiết bị trả lời.`);
      })
      .catch((e: Error) => cb.onLog(`SNMP broadcast lỗi: ${e.message}`));

    const manual = Promise.all(
      manualIps.filter(isValidIPv4).map(async (m) => {
        observe({ method: 'manual', ip: m });
        (await probeAddress(m).catch(() => [])).forEach(observe);
      }),
    );

    const plan = planSweep(ip, prefix);
    if (plan.narrowed) notes.push(`Subnet quá lớn: chỉ quét TCP trong ${plan.scope}.`);
    cb.onLog(`Quét TCP ${plan.hosts.length} địa chỉ trong ${plan.scope}, cổng ${SWEEP_PORTS.join(', ')}.`);
    const batches = chunk(plan.hosts, SWEEP_CHUNK);
    for (let i = 0; i < batches.length; i++) {
      if (finished) return;
      cb.onProgress({
        phase: 'tcp',
        fraction: 0.05 + 0.85 * (i / Math.max(1, batches.length)),
        message: `Quét TCP ${Math.min((i + 1) * SWEEP_CHUNK, plan.hosts.length)}/${plan.hosts.length} địa chỉ…`,
      });
      try {
        const results = await probeHosts({ hosts: batches[i], ports: SWEEP_PORTS, timeoutMs: SWEEP_TIMEOUT_MS, concurrency: SWEEP_CONCURRENCY });
        results.forEach((r) => observe({ method: 'tcp', ip: r.host, ports: r.ports }));
      } catch (e) {
        cb.onLog(`Lỗi quét TCP: ${(e as Error).message}`);
      }
    }

    await Promise.all([snmp, manual]);
    const remaining = MDNS_MIN_MS - (Date.now() - started);
    if (remaining > 0 && !finished) {
      cb.onProgress({ phase: 'mdns', fraction: 0.92, message: 'Đang chờ thêm phản hồi mDNS…' });
      await new Promise((r) => setTimeout(r, remaining));
    }
    if (finished) return;

    const arp = await readArpTable().catch(() => null);
    if (arp?.available) {
      arp.entries
        .filter((e) => e.flags === '0x2' && e.mac !== '00:00:00:00:00:00')
        .forEach((e) => {
          // ARP only adds a MAC to devices another method found; it is not a printer finder.
          if (devices.has(e.ip)) observe({ method: 'arp', ip: e.ip, mac: e.mac });
        });
    } else if (arp) {
      notes.push(`Không đọc được MAC qua ARP: ${arp.reason}.`);
    }
    finish('done');
  };

  if (!isNetworkToolsAvailable) {
    finish('error', { code: 'native-missing', message: 'Thiếu module mạng native.' });
  } else {
    run().catch((e: Error) => {
      cb.onLog(`Lỗi khi quét: ${e.message}`);
      finish('done');
    });
  }

  return { cancel: () => finish('cancelled'), done };
}

/** Probes one manually entered address outside a full scan. */
export async function probeManualAddress(
  ip: string,
  devices: Map<string, DiscoveredDevice>,
): Promise<DiscoveredDevice | null> {
  applyObservation(devices, { method: 'manual', ip });
  for (const obs of await probeAddress(ip).catch(() => [])) applyObservation(devices, obs);
  return devices.get(ip) ?? null;
}
