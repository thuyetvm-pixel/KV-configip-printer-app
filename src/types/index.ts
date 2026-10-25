import type { PortState } from '../../modules/network-tools';

export type { PortState };

export type PermissionState = 'granted' | 'denied' | 'blocked' | 'not-needed' | 'unknown';

/** Snapshot of the phone's network. Fields stay null when Android does not expose them – never guessed. */
export type PhoneNetwork = {
  sdkInt: number | null;
  wifiEnabled: boolean | null;
  onWifi: boolean;
  ssid: string | null;
  ipAddress: string | null;
  prefixLength: number | null;
  subnetMask: string | null;
  gateway: string | null;
  dhcpServer: string | null;
  locationPermission: PermissionState;
  nativeModuleAvailable: boolean;
  /** Explanations for each field that could not be read, shown to the technician */
  issues: string[];
  readAt: number;
};

/** The network the printer must be moved into (captured from the phone while it is on DHCP). */
export type TargetNetwork = {
  ipAddress: string;
  prefixLength: number;
  gateway: string | null;
  ssid: string | null;
};

export type DiscoveryMethod = 'mdns' | 'snmp' | 'tcp' | 'arp' | 'manual';

/**
 * - confirmed: a printer protocol answered (mDNS printer service, Printer-MIB)
 * - likely: printer ports open or a printer-looking SNMP/mDNS description
 * - device: some host answered, nothing says it is a printer
 * - unverified: only known from the technician's input, nothing answered yet
 */
export type Confidence = 'confirmed' | 'likely' | 'device' | 'unverified';

export type Evidence = {
  method: DiscoveryMethod;
  detail: string;
  at: number;
};

export type DiscoveredDevice = {
  ip: string;
  hostname?: string;
  serviceName?: string;
  model?: string;
  manufacturer?: string;
  /** 'oui' means guessed from the MAC prefix only */
  manufacturerSource?: 'mdns' | 'snmp' | 'oui';
  mac?: string;
  serialNumber?: string;
  sysDescr?: string;
  /** Open TCP ports and advertised service ports */
  openPorts: number[];
  services: string[];
  adminUrl?: string;
  methods: DiscoveryMethod[];
  evidence: Evidence[];
  confidence: Confidence;
};

export type SubnetStatus = 'same' | 'different' | 'unknown' | 'unchecked';

export type ScanPhase = 'idle' | 'preparing' | 'mdns' | 'snmp' | 'tcp' | 'done' | 'cancelled' | 'error';

export type ScanProgress = {
  phase: ScanPhase;
  /** 0..1 */
  fraction: number;
  message: string;
};

export type ScanErrorCode =
  | 'native-missing'
  | 'wifi-off'
  | 'not-on-wifi'
  | 'no-ip'
  | 'network-changed';
