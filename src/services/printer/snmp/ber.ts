/**
 * Minimal BER encoder / decoder for SNMP v1 / v2c messages (GetRequest, SetRequest, GetResponse).
 * Only the ASN.1 types printers actually return are handled.
 */

export const Tag = {
  Integer: 0x02,
  OctetString: 0x04,
  Null: 0x05,
  Oid: 0x06,
  Sequence: 0x30,
  IpAddress: 0x40,
  Counter32: 0x41,
  Gauge32: 0x42,
  TimeTicks: 0x43,
  NoSuchObject: 0x80,
  NoSuchInstance: 0x81,
  EndOfMibView: 0x82,
  GetRequest: 0xa0,
  GetNextRequest: 0xa1,
  GetResponse: 0xa2,
  SetRequest: 0xa3,
} as const;

export const SnmpVersion = { v1: 0, v2c: 1 } as const;
export type SnmpVersion = (typeof SnmpVersion)[keyof typeof SnmpVersion];

export type SnmpValue =
  | { type: 'integer'; value: number }
  | { type: 'octets'; value: Uint8Array }
  | { type: 'oid'; value: string }
  | { type: 'ip'; value: string }
  | { type: 'null'; value: null }
  | { type: 'noSuch'; value: null };

export type VarBind = { oid: string; value: SnmpValue };

export type SnmpMessage = {
  version: number;
  community: string;
  pduType: number;
  requestId: number;
  errorStatus: number;
  errorIndex: number;
  varbinds: VarBind[];
};

// ---------- encoding ----------

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

function encodeLength(len: number): Uint8Array {
  if (len < 0x80) return Uint8Array.of(len);
  const bytes: number[] = [];
  for (let n = len; n > 0; n = Math.floor(n / 256)) bytes.unshift(n & 0xff);
  return Uint8Array.of(0x80 | bytes.length, ...bytes);
}

function tlv(tag: number, content: Uint8Array): Uint8Array {
  return concat([Uint8Array.of(tag), encodeLength(content.length), content]);
}

export function encodeInteger(value: number): Uint8Array {
  const bytes: number[] = [];
  let n = value;
  do {
    bytes.unshift(n & 0xff);
    n = Math.floor(n / 256);
  } while (n !== 0 && n !== -1);
  // Keep the sign bit right (two's complement).
  if (value >= 0 && bytes[0] & 0x80) bytes.unshift(0x00);
  if (value < 0 && !(bytes[0] & 0x80)) bytes.unshift(0xff);
  return tlv(Tag.Integer, Uint8Array.from(bytes));
}

export function encodeOctetString(value: string | Uint8Array): Uint8Array {
  const bytes = typeof value === 'string' ? Uint8Array.from(value, (c) => c.charCodeAt(0) & 0xff) : value;
  return tlv(Tag.OctetString, bytes);
}

export function encodeNull(): Uint8Array {
  return Uint8Array.of(Tag.Null, 0x00);
}

export function encodeOid(oid: string): Uint8Array {
  const parts = oid.replace(/^\./, '').split('.').map(Number);
  if (parts.length < 2 || parts.some((p) => !Number.isInteger(p) || p < 0)) {
    throw new Error(`OID không hợp lệ: ${oid}`);
  }
  const bytes: number[] = [parts[0] * 40 + parts[1]];
  for (const part of parts.slice(2)) {
    const chunk: number[] = [part & 0x7f];
    for (let n = Math.floor(part / 128); n > 0; n = Math.floor(n / 128)) chunk.unshift((n & 0x7f) | 0x80);
    bytes.push(...chunk);
  }
  return tlv(Tag.Oid, Uint8Array.from(bytes));
}

export function encodeIpAddress(ip: string): Uint8Array {
  return tlv(Tag.IpAddress, Uint8Array.from(ip.split('.').map(Number)));
}

export function encodeSequence(...items: Uint8Array[]): Uint8Array {
  return tlv(Tag.Sequence, concat(items));
}

export type OutgoingVarBind = { oid: string; value?: Uint8Array /* pre-encoded, NULL when omitted */ };

export function encodeMessage(opts: {
  version: SnmpVersion;
  community: string;
  pduType: number;
  requestId: number;
  varbinds: OutgoingVarBind[];
}): Uint8Array {
  const varbindList = encodeSequence(
    ...opts.varbinds.map((vb) => encodeSequence(encodeOid(vb.oid), vb.value ?? encodeNull())),
  );
  const pdu = tlv(
    opts.pduType,
    concat([encodeInteger(opts.requestId), encodeInteger(0), encodeInteger(0), varbindList]),
  );
  return encodeSequence(encodeInteger(opts.version), encodeOctetString(opts.community), pdu);
}

// ---------- decoding ----------

type Node = { tag: number; start: number; end: number };

function readNode(buf: Uint8Array, pos: number): Node & { next: number } {
  if (pos + 2 > buf.length) throw new Error('BER: hết dữ liệu');
  const tag = buf[pos];
  let len = buf[pos + 1];
  let start = pos + 2;
  if (len & 0x80) {
    const count = len & 0x7f;
    if (count === 0 || count > 4) throw new Error('BER: độ dài không hỗ trợ');
    len = 0;
    for (let i = 0; i < count; i++) len = len * 256 + buf[start + i];
    start += count;
  }
  const end = start + len;
  if (end > buf.length) throw new Error('BER: độ dài vượt gói tin');
  return { tag, start, end, next: end };
}

function children(buf: Uint8Array, node: Node): Node[] {
  const out: Node[] = [];
  for (let pos = node.start; pos < node.end; ) {
    const child = readNode(buf, pos);
    out.push(child);
    pos = child.next;
  }
  return out;
}

function decodeInteger(buf: Uint8Array, node: Node): number {
  let n = buf[node.start] & 0x80 ? -1 : 0;
  for (let i = node.start; i < node.end; i++) n = n * 256 + buf[i];
  return n;
}

function decodeUnsigned(buf: Uint8Array, node: Node): number {
  let n = 0;
  for (let i = node.start; i < node.end; i++) n = n * 256 + buf[i];
  return n;
}

function decodeOid(buf: Uint8Array, node: Node): string {
  const first = buf[node.start];
  const parts = [Math.floor(first / 40), first % 40];
  let acc = 0;
  for (let i = node.start + 1; i < node.end; i++) {
    acc = acc * 128 + (buf[i] & 0x7f);
    if (!(buf[i] & 0x80)) {
      parts.push(acc);
      acc = 0;
    }
  }
  return parts.join('.');
}

function decodeValue(buf: Uint8Array, node: Node): SnmpValue {
  switch (node.tag) {
    case Tag.Integer:
      return { type: 'integer', value: decodeInteger(buf, node) };
    case Tag.Counter32:
    case Tag.Gauge32:
    case Tag.TimeTicks:
      return { type: 'integer', value: decodeUnsigned(buf, node) };
    case Tag.OctetString:
      return { type: 'octets', value: buf.slice(node.start, node.end) };
    case Tag.Oid:
      return { type: 'oid', value: decodeOid(buf, node) };
    case Tag.IpAddress:
      return { type: 'ip', value: Array.from(buf.slice(node.start, node.end)).join('.') };
    case Tag.NoSuchObject:
    case Tag.NoSuchInstance:
    case Tag.EndOfMibView:
      return { type: 'noSuch', value: null };
    default:
      return { type: 'null', value: null };
  }
}

export function decodeMessage(buf: Uint8Array): SnmpMessage {
  const root = readNode(buf, 0);
  if (root.tag !== Tag.Sequence) throw new Error('Không phải gói SNMP');
  const [versionNode, communityNode, pduNode] = children(buf, root);
  const [reqId, errStatus, errIndex, vbList] = children(buf, pduNode);
  const varbinds = children(buf, vbList).map((vb) => {
    const [oidNode, valueNode] = children(buf, vb);
    return { oid: decodeOid(buf, oidNode), value: decodeValue(buf, valueNode) };
  });
  return {
    version: decodeInteger(buf, versionNode),
    community: String.fromCharCode(...buf.slice(communityNode.start, communityNode.end)),
    pduType: pduNode.tag,
    requestId: decodeInteger(buf, reqId),
    errorStatus: decodeInteger(buf, errStatus),
    errorIndex: decodeInteger(buf, errIndex),
    varbinds,
  };
}

// ---------- value helpers ----------

export function octetsToText(bytes: Uint8Array): string {
  // Printers mostly answer ASCII / Latin-1; strip trailing NULs and control chars.
  return String.fromCharCode(...bytes)
    .replace(/\0+$/, '')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '')
    .trim();
}

export function octetsToMac(bytes: Uint8Array): string | null {
  if (bytes.length !== 6 || bytes.every((b) => b === 0)) return null;
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0'))
    .join(':')
    .toUpperCase();
}

export const SNMP_ERROR_TEXT: Record<number, string> = {
  1: 'tooBig – gói tin quá lớn',
  2: 'noSuchName – máy in không có OID này',
  3: 'badValue – giá trị không hợp lệ',
  4: 'readOnly – OID chỉ đọc',
  5: 'genErr – lỗi chung từ máy in',
  6: 'noAccess – community không có quyền ghi',
  7: 'wrongType – sai kiểu dữ liệu (thử IpAddress / OctetString)',
  10: 'wrongValue – giá trị bị từ chối',
  16: 'authorizationError – community sai',
  17: 'notWritable – OID không cho phép ghi',
};
