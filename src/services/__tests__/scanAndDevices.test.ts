import { OFFICE_24 } from '../../__tests__/fixtures';
import { applyObservation, computeConfidence, isPrinterResult, knownUsageFrom } from '../discovery/deviceStore';
import { MAX_SWEEP_HOSTS, planSweep } from '../discovery/sweepPlan';
import { buildPhoneNetwork, networkChanged, scanPreflight, type NetworkSources } from '../network/buildPhoneNetwork';
import { classifySubnet } from '../network/subnetStatus';
import { interpretIpValue } from '../printer/autoConfig';
import { interpretReachability, adminUrl } from '../printer/reachability';
import type { DiscoveredDevice } from '../../types';

const goodSources = (over: Partial<NetworkSources> = {}): NetworkSources => ({
  native: {
    sdkInt: 34,
    wifiEnabled: true,
    hasWifiNetwork: true,
    ipAddress: '192.168.1.50',
    prefixLength: 24,
    gateway: '192.168.1.1',
    dhcpServer: '192.168.1.1',
  },
  netInfo: { type: 'wifi', isConnected: true, ssid: 'SHOP', ipAddress: '192.168.1.50', subnet: '255.255.255.0' },
  sdkInt: 34,
  locationPermission: 'granted',
  ...over,
});

describe('phone network & scan preflight', () => {
  it('reads a healthy network without issues', () => {
    const n = buildPhoneNetwork(goodSources(), 0);
    expect(n).toMatchObject({ ipAddress: '192.168.1.50', prefixLength: 24, subnetMask: '255.255.255.0', gateway: '192.168.1.1', ssid: 'SHOP' });
    expect(n.issues).toEqual([]);
    expect(scanPreflight(n)).toEqual({ canScan: true, blockers: [], warnings: [] });
  });

  it('denied location permission hides the SSID but does not block scanning', () => {
    const n = buildPhoneNetwork(goodSources({ locationPermission: 'denied', netInfo: { type: 'wifi', isConnected: true, ssid: '<unknown ssid>' } }));
    expect(n.ssid).toBeNull();
    expect(n.issues.join(' ')).toMatch(/quyền Vị trí/);
    const pre = scanPreflight(n);
    expect(pre.canScan).toBe(true);
    expect(pre.warnings[0]).toMatch(/quyền Vị trí/);
  });

  it('blocks when Wi-Fi is off or not connected', () => {
    const off = buildPhoneNetwork(
      goodSources({
        native: { sdkInt: 34, wifiEnabled: false, hasWifiNetwork: false, ipAddress: null, prefixLength: null, gateway: null, dhcpServer: null },
        netInfo: { type: 'none', isConnected: false },
      }),
    );
    expect(scanPreflight(off).blockers.map((b) => b.code)).toEqual(['wifi-off']);

    const cellular = buildPhoneNetwork(
      goodSources({
        native: { sdkInt: 34, wifiEnabled: true, hasWifiNetwork: false, ipAddress: null, prefixLength: null, gateway: null, dhcpServer: null },
        netInfo: { type: 'cellular', isConnected: true },
      }),
    );
    expect(scanPreflight(cellular).blockers.map((b) => b.code)).toEqual(['not-on-wifi']);
  });

  it('blocks without the native module and never invents a gateway', () => {
    const n = buildPhoneNetwork(goodSources({ native: null }));
    expect(n.gateway).toBeNull();
    expect(n.ipAddress).toBe('192.168.1.50');
    expect(n.prefixLength).toBe(24);
    expect(scanPreflight(n).blockers.map((b) => b.code)).toEqual(['native-missing']);
  });

  it('reports a missing prefix instead of assuming /24', () => {
    const n = buildPhoneNetwork(
      goodSources({
        native: { sdkInt: 34, wifiEnabled: true, hasWifiNetwork: true, ipAddress: '10.1.2.3', prefixLength: null, gateway: null, dhcpServer: null },
        netInfo: { type: 'wifi', isConnected: true, ssid: 'X', subnet: null },
      }),
    );
    expect(n.prefixLength).toBeNull();
    expect(n.subnetMask).toBeNull();
    expect(scanPreflight(n).blockers.map((b) => b.code)).toEqual(['no-prefix']);
    expect(n.issues.join(' ')).toMatch(/gateway/);
  });

  it('handles a null network snapshot', () => {
    expect(scanPreflight(null).canScan).toBe(false);
  });

  it('detects a network change during a scan', () => {
    const a = buildPhoneNetwork(goodSources());
    const b = buildPhoneNetwork(goodSources({ native: { ...goodSources().native!, ipAddress: '192.168.1.77' } }));
    expect(networkChanged(a, a)).toBe(false);
    expect(networkChanged(a, b)).toBe(true);
  });
});

describe('subnet classification', () => {
  it('matches the spec example and the four states', () => {
    expect(classifySubnet(OFFICE_24, '192.168.1.120')).toBe('same');
    expect(classifySubnet(OFFICE_24, '10.0.0.100')).toBe('different');
    expect(classifySubnet({ ipAddress: null, prefixLength: null }, '10.0.0.100')).toBe('unknown');
    expect(classifySubnet(OFFICE_24, 'bad')).toBe('unknown');
    expect(classifySubnet(null, '10.0.0.100')).toBe('unchecked');
  });
});

describe('device evidence & confidence', () => {
  const fresh = () => new Map<string, DiscoveredDevice>();

  it('mDNS printer service -> confirmed, with model and vendor from TXT', () => {
    const m = fresh();
    const d = applyObservation(m, {
      method: 'mdns',
      ip: '10.0.0.100',
      serviceType: 'ipp',
      serviceName: 'Brother HL-L2350DW [3c2af4123456]',
      port: 631,
      txt: { ty: 'Brother HL-L2350DW series', usb_MFG: 'Brother' },
    })!;
    expect(d.confidence).toBe('confirmed');
    expect(d.model).toBe('Brother HL-L2350DW series');
    expect(d.manufacturer).toBe('Brother');
    expect(d.manufacturerSource).toBe('mdns');
    expect(d.mac).toBe('3C:2A:F4:12:34:56');
  });

  it('a plain HTTP device is not called a printer', () => {
    const m = fresh();
    const d = applyObservation(m, { method: 'mdns', ip: '192.168.1.9', serviceType: 'http', serviceName: 'NAS', port: 80 })!;
    expect(d.confidence).toBe('device');
    expect(isPrinterResult(d)).toBe(false);
  });

  it('TCP 9100 open -> likely; refused only -> device; silence -> nothing', () => {
    const m = fresh();
    expect(applyObservation(m, { method: 'tcp', ip: '192.168.1.30', ports: { 9100: 'open', 80: 'open' } })!.confidence).toBe('likely');
    expect(applyObservation(m, { method: 'tcp', ip: '192.168.1.31', ports: { 80: 'refused' } })!.confidence).toBe('device');
    expect(applyObservation(m, { method: 'tcp', ip: '192.168.1.32', ports: { 80: 'timeout' } })).toBeNull();
    expect(m.has('192.168.1.32')).toBe(false);
  });

  it('manual entries stay unverified until something answers, and prove no IP usage', () => {
    const m = fresh();
    const d = applyObservation(m, { method: 'manual', ip: '10.0.0.100' })!;
    expect(d.confidence).toBe('unverified');
    expect(isPrinterResult(d)).toBe(true);
    expect(knownUsageFrom([d])).toEqual([]);
    applyObservation(m, { method: 'snmp', ip: '10.0.0.100', hasPrinterMib: true, sysDescr: 'HP ETHERNET MULTI-ENVIRONMENT' });
    expect(computeConfidence(m.get('10.0.0.100')!)).toBe('confirmed');
    expect(knownUsageFrom([...m.values()])[0].ip).toBe('10.0.0.100');
  });

  it('OUI is only a labelled guess and never overrides protocol data', () => {
    const m = fresh();
    const d = applyObservation(m, { method: 'arp', ip: '192.168.1.40', mac: '00:80:77:AA:BB:CC' })!;
    expect(d.manufacturer).toBe('Brother');
    expect(d.manufacturerSource).toBe('oui');
    applyObservation(m, { method: 'snmp', ip: '192.168.1.40', hasPrinterMib: false, sysDescr: 'Canon iR-ADV C3530' });
    expect(m.get('192.168.1.40')!.manufacturer).toBe('Canon');
  });

  it('rejects invalid IPs', () => {
    expect(applyObservation(fresh(), { method: 'manual', ip: '300.1.1.1' })).toBeNull();
  });
});

describe('sweep plan', () => {
  it('covers the real subnet except the phone', () => {
    const p = planSweep('192.168.1.50', 24);
    expect(p.hosts).toHaveLength(253);
    expect(p.hosts).not.toContain('192.168.1.50');
    expect(p.narrowed).toBe(false);
    expect(planSweep('192.168.1.70', 26).hosts).toHaveLength(61);
    expect(planSweep('192.168.1.1', 22).hosts).toHaveLength(MAX_SWEEP_HOSTS - 1);
  });

  it('narrows very large subnets to the phone /24 and says so', () => {
    const p = planSweep('10.20.30.40', 16);
    expect(p.narrowed).toBe(true);
    expect(p.hosts).toHaveLength(253);
    expect(p.scope).toMatch(/10\.20\.30\.0\/24/);
  });
});

describe('printer reachability & SNMP value parsing', () => {
  it('treats open or refused as reachable, picks the web port', () => {
    expect(interpretReachability({ 80: 'open', 9100: 'open', 443: 'timeout' })).toEqual({ state: 'reachable', openPorts: [80, 9100], webPort: 80 });
    expect(interpretReachability({ 80: 'refused', 9100: 'open' })).toEqual({ state: 'reachable', openPorts: [9100], webPort: null });
    expect(interpretReachability({ 80: 'unreachable' }).state).toBe('no-route');
    expect(interpretReachability({ 80: 'timeout' }).state).toBe('no-response');
  });

  it('only offers the admin page when the printer is reachable on a web port', () => {
    const reach = interpretReachability({ 443: 'open' });
    expect(adminUrl({ ip: '192.168.1.30' }, reach)).toBe('https://192.168.1.30');
    expect(adminUrl({ ip: '192.168.1.30' }, interpretReachability({ 80: 'timeout' }))).toBeNull();
    expect(adminUrl({ ip: '192.168.1.30', adminUrl: 'http://192.168.1.30/admin' }, null)).toBe('http://192.168.1.30/admin');
    expect(adminUrl({ ip: '192.168.1.30', adminUrl: 'http://printer.local/' }, null)).toBeNull();
  });

  it('reads IP values from IpAddress or dotted text, refuses anything else', () => {
    expect(interpretIpValue({ type: 'ip', value: '10.0.0.100' })).toEqual({ ip: '10.0.0.100', type: 'ip' });
    const text = Uint8Array.from('10.0.0.100', (c) => c.charCodeAt(0));
    expect(interpretIpValue({ type: 'octets', value: text })).toEqual({ ip: '10.0.0.100', type: 'octets' });
    expect(interpretIpValue({ type: 'octets', value: Uint8Array.of(10, 0, 0, 100) })).toBeNull();
    expect(interpretIpValue({ type: 'integer', value: 5 })).toBeNull();
    expect(interpretIpValue({ type: 'noSuch', value: null })).toBeNull();
    expect(interpretIpValue(undefined)).toBeNull();
  });
});
