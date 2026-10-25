import { decodeMessage, encodeInteger, encodeIpAddress, encodeMessage, encodeOctetString, octetsToMac, octetsToText } from '../snmp/ber';

const hex = (u: Uint8Array) => Array.from(u, (b) => b.toString(16).padStart(2, '0')).join('');

describe('SNMP BER', () => {
  it('encodes a GetRequest byte-for-byte like net-snmp', () => {
    const req = encodeMessage({ version: 0, community: 'public', pduType: 0xa0, requestId: 1, varbinds: [{ oid: '1.3.6.1.2.1.1.1.0' }] });
    expect(hex(req)).toBe('302602010004067075626c6963a019020101020100020100300e300c06082b060102010101000500');
  });

  it('round-trips values, large OID arcs and negative integers', () => {
    const msg = decodeMessage(
      encodeMessage({
        version: 1,
        community: 'public',
        pduType: 0xa2,
        requestId: 123456789,
        varbinds: [
          { oid: '1.3.6.1.2.1.1.1.0', value: encodeOctetString('HP LaserJet M404') },
          { oid: '1.3.6.1.4.1.11.2.4.3.5.99999', value: encodeIpAddress('10.0.0.100') },
          { oid: '1.3.6.1.2.1.2.2.1.6.1', value: encodeOctetString(Uint8Array.of(0, 0x80, 0x77, 0x12, 0x34, 0x56)) },
          { oid: '1.3.6.1.2.1.1.3.0', value: encodeInteger(-129) },
        ],
      }),
    );
    expect(msg.requestId).toBe(123456789);
    const [descr, ip, mac, int] = msg.varbinds;
    expect(descr.value.type === 'octets' && octetsToText(descr.value.value)).toBe('HP LaserJet M404');
    expect(ip).toEqual({ oid: '1.3.6.1.4.1.11.2.4.3.5.99999', value: { type: 'ip', value: '10.0.0.100' } });
    expect(mac.value.type === 'octets' && octetsToMac(mac.value.value)).toBe('00:80:77:12:34:56');
    expect(int.value).toEqual({ type: 'integer', value: -129 });
  });

  it('rejects garbage instead of crashing', () => {
    expect(() => decodeMessage(Uint8Array.of(1, 2, 3))).toThrow();
  });
});
