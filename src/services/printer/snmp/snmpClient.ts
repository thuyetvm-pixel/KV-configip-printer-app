import { udpExchange } from '../../../../modules/network-tools';
import {
  SNMP_ERROR_TEXT,
  SnmpVersion,
  Tag,
  decodeMessage,
  encodeInteger,
  encodeIpAddress,
  encodeMessage,
  encodeOctetString,
  octetsToMac,
  octetsToText,
  type SnmpMessage,
  type SnmpValue,
  type VarBind,
} from './ber';

const SNMP_PORT = 161;

export const OID = {
  sysDescr: '1.3.6.1.2.1.1.1.0',
  sysName: '1.3.6.1.2.1.1.5.0',
  hrDeviceDescr1: '1.3.6.1.2.1.25.3.2.1.3.1',
  ifPhysAddress1: '1.3.6.1.2.1.2.2.1.6.1',
  ifPhysAddress2: '1.3.6.1.2.1.2.2.1.6.2',
  prtGeneralSerialNumber1: '1.3.6.1.2.1.43.5.1.1.17.1',
} as const;

/** Bundled into a single v2c request (v2c answers noSuchObject per OID instead of failing). */
const DISCOVERY_OIDS = [
  OID.sysDescr,
  OID.sysName,
  OID.hrDeviceDescr1,
  OID.ifPhysAddress1,
  OID.ifPhysAddress2,
  OID.prtGeneralSerialNumber1,
];

export type SnmpDevice = {
  ip: string;
  sysDescr?: string;
  sysName?: string;
  model?: string;
  mac?: string;
  serialNumber?: string;
  /** Answered a Printer-MIB OID, i.e. almost certainly a printer */
  hasPrinterMib: boolean;
};

let nextRequestId = Math.floor(Math.random() * 0x3fffffff);
const newRequestId = () => (nextRequestId = (nextRequestId + 1) & 0x3fffffff);

function text(vb: VarBind | undefined): string | undefined {
  if (vb?.value.type !== 'octets') return undefined;
  return octetsToText(vb.value.value) || undefined;
}

function mergeResponse(device: SnmpDevice, msg: SnmpMessage) {
  const byOid = new Map(msg.varbinds.map((vb) => [vb.oid, vb]));
  device.sysDescr ??= text(byOid.get(OID.sysDescr));
  device.sysName ??= text(byOid.get(OID.sysName));
  device.model ??= text(byOid.get(OID.hrDeviceDescr1));
  device.serialNumber ??= text(byOid.get(OID.prtGeneralSerialNumber1));
  if (device.serialNumber) device.hasPrinterMib = true;
  for (const oid of [OID.ifPhysAddress1, OID.ifPhysAddress2]) {
    const vb = byOid.get(oid);
    if (!device.mac && vb?.value.type === 'octets') device.mac = octetsToMac(vb.value.value) ?? undefined;
  }
}

function tryDecode(data: Uint8Array): SnmpMessage | null {
  try {
    return decodeMessage(data);
  } catch {
    return null;
  }
}

/**
 * Read-only SNMP GET (community "public" by default) sent to broadcast addresses.
 *
 * 255.255.255.255 reaches every host on the same L2 segment whatever its subnet, but the printer
 * must still route its unicast reply back to the phone: a printer on another subnet without a
 * working default gateway usually stays silent. Broadcasts never cross a router or VLAN.
 */
export async function discoverSnmpDevices(opts: {
  broadcastAddresses: string[];
  community?: string;
  timeoutMs?: number;
}): Promise<SnmpDevice[]> {
  const community = opts.community ?? 'public';
  const requests = [
    // v2c: everything at once
    { version: SnmpVersion.v2c, oids: DISCOVERY_OIDS },
    // v1 fallback: one OID per request, a single unknown OID would fail the whole v1 request
    ...[OID.sysDescr, OID.sysName, OID.ifPhysAddress1].map((oid) => ({ version: SnmpVersion.v1, oids: [oid] })),
  ];
  const requestIds = new Set<number>();
  const payloads = requests.map((req) => {
    const requestId = newRequestId();
    requestIds.add(requestId);
    return encodeMessage({
      version: req.version,
      community,
      pduType: Tag.GetRequest,
      requestId,
      varbinds: req.oids.map((oid) => ({ oid })),
    });
  });

  const replies = await udpExchange({
    targets: opts.broadcastAddresses,
    port: SNMP_PORT,
    payloads,
    timeoutMs: opts.timeoutMs ?? 3000,
    rounds: 2,
  });

  const devices = new Map<string, SnmpDevice>();
  for (const reply of replies) {
    const msg = tryDecode(reply.data);
    if (!msg || msg.pduType !== Tag.GetResponse || !requestIds.has(msg.requestId)) continue;
    const device = devices.get(reply.address) ?? { ip: reply.address, hasPrinterMib: false };
    mergeResponse(device, msg);
    devices.set(reply.address, device);
  }
  return [...devices.values()];
}

export type SnmpGetResult =
  | { ok: true; values: Record<string, SnmpValue> }
  | { ok: false; reason: 'timeout' | 'error-status'; message: string };

const NO_ANSWER =
  'Không có phản hồi SNMP: máy in không nhận được gói (khác subnet / không định tuyến được), SNMP bị tắt, ' +
  'hoặc community sai (máy in thường im lặng khi sai community).';

function errorText(msg: SnmpMessage): string {
  const reason = SNMP_ERROR_TEXT[msg.errorStatus] ?? `errorStatus ${msg.errorStatus}`;
  return `Máy in từ chối (varbind #${msg.errorIndex}): ${reason}`;
}

/** Unicast GET. v2c so a missing OID comes back as noSuch instead of failing the whole request. */
export async function snmpGet(opts: {
  ip: string;
  community: string;
  oids: string[];
  version?: SnmpVersion;
  timeoutMs?: number;
}): Promise<SnmpGetResult> {
  const requestId = newRequestId();
  const payload = encodeMessage({
    version: opts.version ?? SnmpVersion.v2c,
    community: opts.community,
    pduType: Tag.GetRequest,
    requestId,
    varbinds: opts.oids.map((oid) => ({ oid })),
  });
  const replies = await udpExchange({ targets: [opts.ip], port: SNMP_PORT, payloads: [payload], timeoutMs: opts.timeoutMs ?? 2500, rounds: 2 });
  const res = replies.map((r) => tryDecode(r.data)).find((m) => m?.requestId === requestId);
  if (!res) return { ok: false, reason: 'timeout', message: NO_ANSWER };
  if (res.errorStatus !== 0) return { ok: false, reason: 'error-status', message: errorText(res) };
  return { ok: true, values: Object.fromEntries(res.varbinds.map((vb) => [vb.oid, vb.value])) };
}

export type SetValueType = 'ip' | 'octets' | 'integer';

export type SnmpSetResult = { ok: true; message: string } | { ok: false; message: string };

/** Unicast SetRequest. Callers must have verified the OID and write access first (see autoConfig.ts). */
export async function snmpSet(opts: {
  ip: string;
  community: string;
  varbinds: { oid: string; type: SetValueType; value: string }[];
  version?: SnmpVersion;
  timeoutMs?: number;
}): Promise<SnmpSetResult> {
  const requestId = newRequestId();
  const payload = encodeMessage({
    version: opts.version ?? SnmpVersion.v2c,
    community: opts.community,
    pduType: Tag.SetRequest,
    requestId,
    varbinds: opts.varbinds.map((vb) => ({
      oid: vb.oid,
      value:
        vb.type === 'ip'
          ? encodeIpAddress(vb.value)
          : vb.type === 'integer'
            ? encodeInteger(Number(vb.value))
            : encodeOctetString(vb.value),
    })),
  });

  // A single round: a SET must not be repeated blindly.
  const replies = await udpExchange({ targets: [opts.ip], port: SNMP_PORT, payloads: [payload], timeoutMs: opts.timeoutMs ?? 4000 });
  const res = replies.map((r) => tryDecode(r.data)).find((m) => m?.requestId === requestId);
  if (!res) return { ok: false, message: NO_ANSWER };
  if (res.errorStatus === 0) return { ok: true, message: 'Máy in đã chấp nhận lệnh SET.' };
  return { ok: false, message: errorText(res) };
}
