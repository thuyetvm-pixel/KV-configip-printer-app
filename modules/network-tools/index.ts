import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo-modules-core';

export type LinkInfo = {
  sdkInt: number;
  wifiEnabled: boolean | null;
  hasWifiNetwork: boolean;
  ipAddress: string | null;
  prefixLength: number | null;
  gateway: string | null;
  dhcpServer: string | null;
  interfaceName: string | null;
  dnsServers: string[];
};

/** Result of one TCP connect attempt. */
export type PortState = 'open' | 'refused' | 'timeout' | 'unreachable' | 'error';

export type HostProbe = { host: string; ports: Record<number, PortState> };

export type ArpEntry = { ip: string; mac: string; flags: string; device: string };
export type ArpTable = { available: boolean; reason: string | null; entries: ArpEntry[] };

export type UdpReply = { address: string; port: number; data: Uint8Array };

type NetworkToolsNative = {
  getLinkInfo(): LinkInfo;
  acquireMulticastLock(): boolean;
  releaseMulticastLock(): boolean;
  udpExchange(
    targets: string[],
    port: number,
    payloadsBase64: string[],
    timeoutMs: number,
    rounds: number,
  ): Promise<{ address: string; port: number; data: string }[]>;
  probeHosts(
    hosts: string[],
    ports: number[],
    timeoutMs: number,
    concurrency: number,
  ): Promise<{ host: string; ports: Record<string, PortState> }[]>;
  readArpTable(): Promise<ArpTable>;
};

// Optional: the module only exists in an Android development/release build (not in Expo Go, iOS or Jest).
const native =
  Platform.OS === 'android' ? requireOptionalNativeModule<NetworkToolsNative>('NetworkTools') : null;

export const isNetworkToolsAvailable = native != null;

export class NativeModuleMissingError extends Error {
  constructor() {
    super('Module NetworkTools chưa có – cần cài bản build Android của app (không chạy được trên Expo Go).');
  }
}

function requireNative(): NetworkToolsNative {
  if (!native) throw new NativeModuleMissingError();
  return native;
}

export function getLinkInfo(): LinkInfo | null {
  return native?.getLinkInfo() ?? null;
}

export function acquireMulticastLock(): boolean {
  return native?.acquireMulticastLock() ?? false;
}

export function releaseMulticastLock(): void {
  native?.releaseMulticastLock();
}

/**
 * Sends every payload to every target (`rounds` times, UDP is lossy) from one socket bound to
 * the Wi-Fi network, then returns all datagrams received before `timeoutMs`.
 */
export async function udpExchange(opts: {
  targets: string[];
  port: number;
  payloads: Uint8Array[];
  timeoutMs: number;
  rounds?: number;
}): Promise<UdpReply[]> {
  const replies = await requireNative().udpExchange(
    opts.targets,
    opts.port,
    opts.payloads.map(toBase64),
    opts.timeoutMs,
    opts.rounds ?? 1,
  );
  return replies.map((r) => ({ ...r, data: fromBase64(r.data) }));
}

/** TCP connect probes, `concurrency` sockets at a time, all on the Wi-Fi network. */
export async function probeHosts(opts: {
  hosts: string[];
  ports: number[];
  timeoutMs: number;
  concurrency?: number;
}): Promise<HostProbe[]> {
  if (opts.hosts.length === 0) return [];
  const raw = await requireNative().probeHosts(opts.hosts, opts.ports, opts.timeoutMs, opts.concurrency ?? 48);
  return raw.map((r) => ({
    host: r.host,
    ports: Object.fromEntries(Object.entries(r.ports).map(([p, s]) => [Number(p), s])),
  }));
}

export async function readArpTable(): Promise<ArpTable> {
  if (!native) return { available: false, reason: 'Module native chưa có', entries: [] };
  return native.readArpTable();
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function fromBase64(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}
