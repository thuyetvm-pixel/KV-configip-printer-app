import {
  broadcastAddress,
  composeWithLastOctet,
  enumerateHosts,
  fixedPrefixOctets,
  formatIPv4,
  hostRange,
  isInSubnet,
  isNetworkOrBroadcast,
  isValidIPv4,
  isValidPrefix,
  maskToPrefix,
  networkAddress,
  parseIPv4,
  prefixToMask,
  subnetOf,
  usableHostCount,
} from '../ipv4';

describe('IPv4 validation', () => {
  it.each(['192.168.1.1', '0.0.0.0', '255.255.255.255', '10.0.0.100'])('accepts %s', (ip) => {
    expect(isValidIPv4(ip)).toBe(true);
  });

  it.each(['', '192.168.1', '192.168.1.256', '192.168.01.1', '1.2.3.4.5', ' 1.2.3.4', 'a.b.c.d', '192.168.1.-1', '1..2.3'])(
    'rejects %p',
    (ip) => {
      expect(isValidIPv4(ip)).toBe(false);
    },
  );

  it('round-trips through numbers', () => {
    expect(formatIPv4(parseIPv4('172.16.254.3'))).toBe('172.16.254.3');
    expect(parseIPv4('255.255.255.255')).toBe(0xffffffff);
  });
});

describe('prefix length / mask', () => {
  it.each([
    [0, '0.0.0.0'],
    [8, '255.0.0.0'],
    [22, '255.255.252.0'],
    [24, '255.255.255.0'],
    [27, '255.255.255.224'],
    [32, '255.255.255.255'],
  ])('/%i <-> %s', (prefix, mask) => {
    expect(prefixToMask(prefix)).toBe(mask);
    expect(maskToPrefix(mask)).toBe(prefix);
  });

  it('rejects non-contiguous or invalid masks', () => {
    expect(maskToPrefix('255.0.255.0')).toBeNull();
    expect(maskToPrefix('255.255.255.1')).toBeNull();
    expect(maskToPrefix('300.0.0.0')).toBeNull();
  });

  it('validates prefix values', () => {
    expect(isValidPrefix(24)).toBe(true);
    expect(isValidPrefix(33)).toBe(false);
    expect(isValidPrefix(-1)).toBe(false);
    expect(isValidPrefix(24.5)).toBe(false);
    expect(() => prefixToMask(33)).toThrow();
  });
});

describe('network and broadcast address', () => {
  it.each([
    ['192.168.1.50', 24, '192.168.1.0', '192.168.1.255'],
    ['192.168.2.77', 22, '192.168.0.0', '192.168.3.255'],
    ['10.0.0.100', 8, '10.0.0.0', '10.255.255.255'],
    ['192.168.1.70', 26, '192.168.1.64', '192.168.1.127'],
    ['192.168.1.70', 30, '192.168.1.68', '192.168.1.71'],
  ])('%s/%i -> %s .. %s', (ip, prefix, net, bc) => {
    expect(networkAddress(ip, prefix)).toBe(net);
    expect(broadcastAddress(ip, prefix)).toBe(bc);
  });

  it('handles /31 and /32 host ranges', () => {
    expect(hostRange(subnetOf('10.0.0.4', 31))).toEqual({ first: parseIPv4('10.0.0.4'), last: parseIPv4('10.0.0.5') });
    expect(hostRange(subnetOf('10.0.0.4', 32))).toEqual({ first: parseIPv4('10.0.0.4'), last: parseIPv4('10.0.0.4') });
    expect(usableHostCount(24)).toBe(254);
    expect(usableHostCount(30)).toBe(2);
    expect(isNetworkOrBroadcast('10.0.0.4', subnetOf('10.0.0.4', 31))).toBe(false);
  });

  it('enumerates hosts without network/broadcast', () => {
    const hosts = enumerateHosts(subnetOf('192.168.1.70', 29));
    expect(hosts).toEqual(['192.168.1.65', '192.168.1.66', '192.168.1.67', '192.168.1.68', '192.168.1.69', '192.168.1.70']);
  });
});

describe('same / different subnet', () => {
  const s24 = subnetOf('192.168.1.50', 24);
  it('matches the spec example', () => {
    expect(isInSubnet('192.168.1.120', s24)).toBe(true);
    expect(isInSubnet('10.0.0.100', s24)).toBe(false);
  });
  it('uses the real prefix, not /24', () => {
    const s22 = subnetOf('192.168.0.10', 22);
    expect(isInSubnet('192.168.3.200', s22)).toBe(true);
    const s26 = subnetOf('192.168.1.10', 26);
    expect(isInSubnet('192.168.1.100', s26)).toBe(false);
  });
});

describe('last-octet editing', () => {
  it('only offers it for prefix >= 24', () => {
    expect(fixedPrefixOctets(subnetOf('192.168.1.50', 24))).toBe('192.168.1');
    expect(fixedPrefixOctets(subnetOf('192.168.1.50', 26))).toBe('192.168.1');
    expect(fixedPrefixOctets(subnetOf('192.168.1.50', 23))).toBeNull();
  });
  it('composes and validates the octet', () => {
    expect(composeWithLastOctet('192.168.1', '201')).toBe('192.168.1.201');
    expect(composeWithLastOctet('192.168.1', '256')).toBeNull();
    expect(composeWithLastOctet('192.168.1', '')).toBeNull();
    expect(composeWithLastOctet('192.168.1', '2a')).toBeNull();
  });
});
