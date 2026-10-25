import { ctx, OFFICE_24 } from '../../../__tests__/fixtures';
import { canConfirmIp, decideConflict, type ProbeEvidence } from '../conflictDecision';
import { suggestIps } from '../suggestIp';
import { validateCandidate } from '../validateIp';

const codes = (ip: string, c = ctx()) => validateCandidate(ip, c).map((i) => i.code);

const silentProbe = (over: Partial<ProbeEvidence> = {}): ProbeEvidence => ({
  phoneOnTargetNetwork: true,
  tcp: { 80: 'unreachable', 443: 'unreachable', 9100: 'unreachable' },
  arpAvailable: false,
  snmpAnswered: false,
  ...over,
});

describe('validateCandidate', () => {
  it('flags the phone IP as in use', () => {
    expect(validateCandidate('192.168.1.50', ctx())).toEqual([
      expect.objectContaining({ code: 'phone-ip', kind: 'in-use' }),
    ]);
  });

  it('flags the gateway as in use', () => {
    expect(codes('192.168.1.1')).toEqual(['gateway']);
  });

  it('flags addresses already seen on the network', () => {
    const c = ctx({ knownInUse: [{ ip: '192.168.1.200', reason: 'Máy in HP trả lời mDNS tại IP này.' }] });
    const issues = validateCandidate('192.168.1.200', c);
    expect(issues).toEqual([{ code: 'known-in-use', kind: 'in-use', message: 'Máy in HP trả lời mDNS tại IP này.' }]);
  });

  it('rejects addresses outside the target subnet', () => {
    expect(codes('10.0.0.100')).toEqual(['outside-subnet']);
    expect(codes('192.168.2.10')).toEqual(['outside-subnet']);
  });

  it('rejects network and broadcast addresses', () => {
    expect(codes('192.168.1.0')).toEqual(['network-address']);
    expect(codes('192.168.1.255')).toEqual(['broadcast-address']);
    const c26 = ctx({ target: { ...OFFICE_24, ipAddress: '192.168.1.70', prefixLength: 26 } });
    expect(codes('192.168.1.127', c26)).toEqual(['broadcast-address']);
    expect(codes('192.168.1.64', c26)).toEqual(['network-address']);
  });

  it.each(['192.168.1', '192.168.1.300', 'abc', '', '192.168.1.1.1'])('rejects malformed %p', (ip) => {
    expect(codes(ip)).toEqual(['format']);
  });

  it('warns for the known DHCP range and blocks the DHCP server', () => {
    const c = ctx({ dhcpRange: { start: '192.168.1.100', end: '192.168.1.199' }, dhcpServer: '192.168.1.2' });
    expect(validateCandidate('192.168.1.150', c)).toEqual([expect.objectContaining({ code: 'in-dhcp-range', kind: 'warning' })]);
    expect(codes('192.168.1.200', c)).toEqual([]);
    expect(codes('192.168.1.2', c)).toEqual(['dhcp-server']);
  });
});

describe('suggestIps', () => {
  it('suggests .200 for the spec example', () => {
    expect(suggestIps(ctx()).suggestions[0]).toEqual({ ip: '192.168.1.200', inDhcpRange: false });
  });

  it('skips addresses known to be used and already rejected ones', () => {
    const c = ctx({ knownInUse: [{ ip: '192.168.1.200', reason: 'x' }] });
    expect(suggestIps(c).suggestions[0].ip).toBe('192.168.1.201');
    expect(suggestIps(c, { exclude: ['192.168.1.201'] }).suggestions[0].ip).toBe('192.168.1.202');
  });

  it('never suggests phone, gateway, network or broadcast', () => {
    const tiny = ctx({ target: { ipAddress: '10.1.1.1', prefixLength: 30, gateway: '10.1.1.2', ssid: null } });
    // /30 hosts: .1 (phone) and .2 (gateway) -> nothing left
    expect(suggestIps(tiny).suggestions).toEqual([]);
    expect(suggestIps(tiny).reason).toBeDefined();
  });

  it('respects small prefixes instead of assuming /24', () => {
    const c26 = ctx({ target: { ipAddress: '192.168.1.70', prefixLength: 26, gateway: '192.168.1.65', ssid: null } });
    const ips = suggestIps(c26).suggestions.map((s) => s.ip);
    expect(ips[0]).toBe('192.168.1.126');
    ips.forEach((ip) => expect(validateCandidate(ip, c26)).toEqual([]));
  });

  it('uses the phone /24 block inside a larger subnet', () => {
    const c22 = ctx({ target: { ipAddress: '192.168.2.40', prefixLength: 22, gateway: '192.168.0.1', ssid: null } });
    expect(suggestIps(c22).suggestions[0].ip).toBe('192.168.2.200');
  });

  it('avoids the DHCP range and only falls back to it when nothing else is free', () => {
    const c = ctx({ dhcpRange: { start: '192.168.1.2', end: '192.168.1.230' } });
    const first = suggestIps(c).suggestions[0];
    expect(first).toEqual({ ip: '192.168.1.240', inDhcpRange: false });

    const all = ctx({
      target: { ipAddress: '10.0.0.1', prefixLength: 29, gateway: null, ssid: null },
      dhcpRange: { start: '10.0.0.1', end: '10.0.0.6' },
    });
    const fallback = suggestIps(all).suggestions;
    expect(fallback.length).toBeGreaterThan(0);
    expect(fallback.every((s) => s.inDhcpRange)).toBe(true);
  });

  it('returns a reason when the target network is unknown', () => {
    const r = suggestIps(ctx({ target: { ipAddress: '', prefixLength: 24, gateway: null, ssid: null } }));
    expect(r.suggestions).toEqual([]);
    expect(r.reason).toMatch(/Chưa xác định/);
  });
});

describe('decideConflict', () => {
  it('A: blocks the phone IP / gateway / known address without probing', () => {
    expect(decideConflict('192.168.1.50', ctx()).kind).toBe('in-use');
    expect(decideConflict('192.168.1.1', ctx()).kind).toBe('in-use');
    const c = ctx({ knownInUse: [{ ip: '192.168.1.210', reason: 'Thấy qua TCP' }] });
    expect(decideConflict('192.168.1.210', c, silentProbe())).toMatchObject({ kind: 'in-use', reasons: ['Thấy qua TCP'] });
  });

  it('invalid: malformed, outside subnet, network, broadcast', () => {
    for (const ip of ['192.168.1.x', '10.0.0.5', '192.168.1.0', '192.168.1.255']) {
      expect(decideConflict(ip, ctx(), silentProbe()).kind).toBe('invalid');
    }
  });

  it('pending until a probe for this exact address exists', () => {
    expect(decideConflict('192.168.1.201', ctx())).toEqual({ kind: 'pending', ip: '192.168.1.201', warnings: [] });
  });

  it('A: a TCP answer (open or refused) means the address is taken', () => {
    const v = decideConflict('192.168.1.201', ctx(), silentProbe({ tcp: { 80: 'timeout', 9100: 'refused' } }));
    expect(v.kind).toBe('in-use');
  });

  it('A: an ARP entry or SNMP answer means the address is taken', () => {
    expect(decideConflict('192.168.1.201', ctx(), silentProbe({ arpAvailable: true, arpMac: '00:80:77:12:34:56' })).kind).toBe('in-use');
    expect(decideConflict('192.168.1.201', ctx(), silentProbe({ arpAvailable: true, arpMac: '00:00:00:00:00:00' })).kind).toBe(
      'no-conflict-found',
    );
    expect(decideConflict('192.168.1.201', ctx(), silentProbe({ snmpAnswered: true })).kind).toBe('in-use');
  });

  it('B: no ARP answer -> no conflict found, with caveats', () => {
    const v = decideConflict('192.168.1.201', ctx(), silentProbe());
    expect(v.kind).toBe('no-conflict-found');
    if (v.kind === 'no-conflict-found') expect(v.caveats.length).toBeGreaterThan(0);
  });

  it('C: unknown states never count as free', () => {
    expect(decideConflict('192.168.1.201', ctx(), silentProbe({ tcp: { 80: 'timeout', 443: 'timeout' } })).kind).toBe('unverifiable');
    expect(decideConflict('192.168.1.201', ctx(), silentProbe({ tcp: { 80: 'error' } })).kind).toBe('unverifiable');
    expect(decideConflict('192.168.1.201', ctx(), silentProbe({ tcp: null, probeError: 'Module native chưa có' })).kind).toBe(
      'unverifiable',
    );
    expect(decideConflict('192.168.1.201', ctx(), silentProbe({ phoneOnTargetNetwork: false })).kind).toBe('unverifiable');
  });

  it('keeps DHCP warnings on every verdict', () => {
    const c = ctx({ dhcpRange: { start: '192.168.1.100', end: '192.168.1.220' } });
    const v = decideConflict('192.168.1.201', c, silentProbe());
    expect(v.kind).toBe('no-conflict-found');
    if (v.kind === 'no-conflict-found') expect(v.warnings[0]).toMatch(/dải DHCP/);
  });

  it('only lets the technician confirm a no-conflict verdict they acknowledged', () => {
    const free = decideConflict('192.168.1.201', ctx(), silentProbe());
    expect(canConfirmIp(free, false)).toBe(false);
    expect(canConfirmIp(free, true)).toBe(true);
    expect(canConfirmIp(decideConflict('192.168.1.50', ctx(), silentProbe()), true)).toBe(false);
    expect(canConfirmIp(decideConflict('192.168.1.201', ctx(), silentProbe({ tcp: { 80: 'timeout' } })), true)).toBe(false);
  });
});
