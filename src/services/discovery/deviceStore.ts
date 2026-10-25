import type { Confidence, DiscoveredDevice, DiscoveryMethod, PortState } from '../../types';
import { compareIPv4, isValidIPv4 } from '../../utils/ipv4';
import type { KnownUsage } from '../ip-management/validateIp';
import { looksLikePrinter, macFromName, vendorFromMac, vendorFromText } from './vendor';

export const PRINTER_MDNS_TYPES = ['printer', 'ipp', 'ipps', 'pdl-datastream'] as const;
export const PRINTER_TCP_PORTS = [9100, 631, 515];

/** One piece of evidence from one protocol. */
export type Observation =
  | {
      method: 'mdns';
      ip: string;
      serviceType: string;
      serviceName: string;
      host?: string;
      port: number;
      txt?: Record<string, string>;
    }
  | {
      method: 'snmp';
      ip: string;
      sysDescr?: string;
      sysName?: string;
      model?: string;
      mac?: string;
      serialNumber?: string;
      hasPrinterMib: boolean;
    }
  | { method: 'tcp'; ip: string; ports: Record<number, PortState> }
  | { method: 'arp'; ip: string; mac: string }
  | { method: 'manual'; ip: string };

function addOnce<T>(list: T[], item: T) {
  if (!list.includes(item)) list.push(item);
}

function emptyDevice(ip: string): DiscoveredDevice {
  return { ip, openPorts: [], services: [], methods: [], evidence: [], confidence: 'unverified' };
}

/** Model / manufacturer / admin URL from Bonjour printing TXT keys. */
function parseTxt(txt: Record<string, string> | undefined) {
  if (!txt) return {};
  const product = txt.product?.replace(/^\(|\)$/g, '');
  return {
    model: txt.ty || txt.usb_MDL || product || undefined,
    manufacturer: txt.usb_MFG || undefined,
    adminUrl: txt.adminurl || undefined,
  };
}

export function computeConfidence(d: DiscoveredDevice): Confidence {
  const printerService = d.services.some((s) => PRINTER_MDNS_TYPES.some((t) => s.startsWith(`_${t}._tcp`)));
  const printerMib = d.evidence.some((e) => e.method === 'snmp' && e.detail.includes('Printer-MIB'));
  if (printerService || printerMib) return 'confirmed';

  const printerPort = d.openPorts.some((p) => PRINTER_TCP_PORTS.includes(p));
  const printerText = looksLikePrinter(d.sysDescr, d.model, d.serviceName, d.hostname);
  if (printerPort || printerText) return 'likely';

  const networkEvidence = d.methods.some((m) => m !== 'manual');
  return networkEvidence ? 'device' : 'unverified';
}

/** Applies an observation to the device map (mutates) and returns the updated device. */
export function applyObservation(
  devices: Map<string, DiscoveredDevice>,
  obs: Observation,
  now = Date.now(),
): DiscoveredDevice | null {
  if (!isValidIPv4(obs.ip)) return null;
  const d = devices.get(obs.ip) ?? emptyDevice(obs.ip);
  const evidence = (method: DiscoveryMethod, detail: string) => {
    addOnce(d.methods, method);
    d.evidence.push({ method, detail, at: now });
  };

  switch (obs.method) {
    case 'mdns': {
      const label = `_${obs.serviceType}._tcp:${obs.port}`;
      addOnce(d.services, label);
      d.serviceName ??= obs.serviceName;
      d.hostname ??= obs.host?.replace(/\.$/, '');
      const txt = parseTxt(obs.txt);
      d.model ??= txt.model;
      d.adminUrl ??= txt.adminUrl;
      d.mac ??= macFromName(obs.serviceName);
      if (obs.serviceType === 'http' || obs.serviceType === 'https') addOnce(d.openPorts, obs.port);
      const brand = txt.manufacturer ?? vendorFromText(txt.model, obs.serviceName);
      if (brand && d.manufacturerSource !== 'snmp') {
        d.manufacturer = brand;
        d.manufacturerSource = 'mdns';
      }
      evidence('mdns', `Dịch vụ ${label} (${obs.serviceName})`);
      break;
    }
    case 'snmp': {
      d.sysDescr ??= obs.sysDescr;
      d.hostname ??= obs.sysName;
      d.model ??= obs.model;
      d.mac ??= obs.mac;
      d.serialNumber ??= obs.serialNumber;
      const brand = vendorFromText(obs.sysDescr, obs.model);
      if (brand) {
        d.manufacturer = brand;
        d.manufacturerSource = 'snmp';
      }
      evidence('snmp', obs.hasPrinterMib ? 'SNMP trả lời Printer-MIB' : `SNMP trả lời${obs.sysDescr ? `: ${obs.sysDescr.slice(0, 80)}` : ''}`);
      break;
    }
    case 'tcp': {
      const answered = Object.entries(obs.ports).filter(([, s]) => s === 'open' || s === 'refused');
      if (!answered.length) return devices.get(obs.ip) ?? null;
      for (const [p, s] of answered) if (s === 'open') addOnce(d.openPorts, Number(p));
      d.openPorts.sort((a, b) => a - b);
      evidence('tcp', `TCP: ${answered.map(([p, s]) => `${p} ${s === 'open' ? 'mở' : 'từ chối'}`).join(', ')}`);
      break;
    }
    case 'arp': {
      d.mac ??= obs.mac;
      evidence('arp', `Bảng ARP: ${obs.mac}`);
      break;
    }
    case 'manual': {
      evidence('manual', 'IP do kỹ thuật viên nhập');
      break;
    }
  }

  if (!d.manufacturer) {
    const fromMac = vendorFromMac(d.mac);
    if (fromMac) {
      d.manufacturer = fromMac;
      d.manufacturerSource = 'oui';
    }
  }
  d.confidence = computeConfidence(d);
  devices.set(obs.ip, d);
  return d;
}

export function isPrinterResult(d: DiscoveredDevice): boolean {
  return d.confidence === 'confirmed' || d.confidence === 'likely' || d.methods.includes('manual');
}

export function sortDevices(list: DiscoveredDevice[]): DiscoveredDevice[] {
  return [...list].sort((a, b) => compareIPv4(a.ip, b.ip));
}

/** Addresses proven to be in use by network evidence (manual entries alone prove nothing). */
export function knownUsageFrom(devices: DiscoveredDevice[]): KnownUsage[] {
  return devices
    .filter((d) => d.methods.some((m) => m !== 'manual'))
    .map((d) => ({
      ip: d.ip,
      reason: `IP này đang được dùng: đã thấy thiết bị ${d.model ?? d.serviceName ?? d.hostname ?? ''} qua ${d.methods
        .filter((m) => m !== 'manual')
        .map((m) => m.toUpperCase())
        .join(', ')}.`.replace(/thiết bị\s+qua/, 'thiết bị qua'),
    }));
}

export const CONFIDENCE_LABEL: Record<Confidence, string> = {
  confirmed: 'Máy in (đã xác nhận)',
  likely: 'Có thể là máy in',
  device: 'Thiết bị mạng',
  unverified: 'Chưa xác minh',
};

export const METHOD_LABEL: Record<DiscoveryMethod, string> = {
  mdns: 'mDNS',
  snmp: 'SNMP',
  tcp: 'TCP',
  arp: 'ARP',
  manual: 'Nhập tay',
};
