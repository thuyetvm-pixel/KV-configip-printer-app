import { probeHosts } from '../../../modules/network-tools';
import { isValidIPv4 } from '../../utils/ipv4';
import { octetsToText, type SnmpValue } from './snmp/ber';
import { snmpGet, snmpSet, type SetValueType } from './snmp/snmpClient';

/**
 * Automatic IP change over SNMP. There is no standard writable OID for a printer's IP (IP-MIB is
 * read-only), so the technician supplies the vendor OIDs. Nothing is changed until preflight proves:
 *   1. the printer answers SNMP with the given write community,
 *   2. the IP OID currently holds the printer's current IP (so it really is the IP setting),
 *   3. writing the *same* value back is accepted (write access exists, no change made).
 */

export type OidRole = 'ip' | 'mask' | 'gateway';

export type ConfigOids = { ip: string; mask?: string; gateway?: string };

export type VerifiedOid = { role: OidRole; oid: string; type: SetValueType; currentValue: string };

export type PreflightResult =
  | { ok: true; oids: VerifiedOid[] }
  | { ok: false; step: 'input' | 'read' | 'match' | 'write-test'; message: string };

const OID_RE = /^\.?\d+(\.\d+)+$/;

export function isValidOid(oid: string | undefined): oid is string {
  return !!oid && OID_RE.test(oid.trim());
}

/** Reads an SNMP value that should hold an IPv4 address, either as IpAddress or as dotted text. */
export function interpretIpValue(value: SnmpValue | undefined): { ip: string; type: SetValueType } | null {
  if (!value) return null;
  if (value.type === 'ip' && isValidIPv4(value.value)) return { ip: value.value, type: 'ip' };
  // Dotted text in an OCTET STRING. Raw 4-byte strings are refused: their write format is unknown.
  if (value.type === 'octets') {
    const asText = octetsToText(value.value);
    if (isValidIPv4(asText)) return { ip: asText, type: 'octets' };
  }
  return null;
}

export async function preflightSnmpConfig(opts: {
  printerIp: string;
  community: string;
  oids: ConfigOids;
}): Promise<PreflightResult> {
  const entries = (Object.entries(opts.oids) as [OidRole, string | undefined][])
    .filter(([, oid]) => oid && oid.trim())
    .map(([role, oid]) => ({ role, oid: oid!.trim().replace(/^\./, '') }));

  if (!opts.community) return { ok: false, step: 'input', message: 'Cần nhập community có quyền ghi.' };
  if (!isValidOid(opts.oids.ip)) return { ok: false, step: 'input', message: 'OID địa chỉ IP không hợp lệ.' };
  const bad = entries.find((e) => !isValidOid(e.oid));
  if (bad) return { ok: false, step: 'input', message: `OID ${bad.role} không hợp lệ.` };

  const read = await snmpGet({ ip: opts.printerIp, community: opts.community, oids: entries.map((e) => e.oid) });
  if (!read.ok) return { ok: false, step: 'read', message: read.message };

  const verified: VerifiedOid[] = [];
  for (const e of entries) {
    const parsed = interpretIpValue(read.values[e.oid]);
    if (!parsed) {
      return { ok: false, step: 'match', message: `OID ${e.role} (${e.oid}) không trả về một địa chỉ IPv4 – có thể sai OID cho dòng máy này.` };
    }
    if (e.role === 'ip' && parsed.ip !== opts.printerIp) {
      return {
        ok: false,
        step: 'match',
        message: `OID IP đang chứa ${parsed.ip}, khác IP hiện tại ${opts.printerIp} – không phải OID cấu hình IP của máy này.`,
      };
    }
    verified.push({ role: e.role, oid: e.oid, type: parsed.type, currentValue: parsed.ip });
  }

  // Write the unchanged values back: proves write access without changing anything.
  const test = await snmpSet({
    ip: opts.printerIp,
    community: opts.community,
    varbinds: verified.map((v) => ({ oid: v.oid, type: v.type, value: v.currentValue })),
  });
  if (!test.ok) return { ok: false, step: 'write-test', message: `Thử ghi lại giá trị cũ thất bại: ${test.message}` };

  return { ok: true, oids: verified };
}

export type ApplyResult =
  | { ok: true; verified: boolean; message: string }
  | { ok: false; message: string };

/** Sends the real change (only after preflight), then checks the printer answers on the new IP. */
export async function applySnmpIpChange(opts: {
  printerIp: string;
  community: string;
  verified: VerifiedOid[];
  newValues: { ip: string; mask?: string; gateway?: string };
  verifyTimeoutMs?: number;
}): Promise<ApplyResult> {
  const varbinds = opts.verified
    .map((v) => ({ oid: v.oid, type: v.type, value: opts.newValues[v.role] }))
    .filter((v): v is { oid: string; type: SetValueType; value: string } => isValidIPv4(v.value));
  if (!varbinds.some((v) => v.oid === opts.verified.find((x) => x.role === 'ip')?.oid)) {
    return { ok: false, message: 'Thiếu IP mới hợp lệ.' };
  }

  const res = await snmpSet({ ip: opts.printerIp, community: opts.community, varbinds });
  if (!res.ok) {
    return {
      ok: false,
      message:
        `${res.message} Lưu ý: nếu không có phản hồi, máy in có thể đã đổi IP ngay trước khi trả lời – hãy quét lại.`,
    };
  }

  const verified = await waitForHost(opts.newValues.ip, opts.verifyTimeoutMs ?? 60000);
  return {
    ok: true,
    verified,
    message: verified
      ? `Đã xác minh: máy in trả lời tại ${opts.newValues.ip}.`
      : `Máy in đã nhận lệnh nhưng chưa trả lời tại ${opts.newValues.ip}. Một số máy cần khởi động lại; ` +
        'nếu điện thoại đang dùng IP tĩnh tạm, hãy chuyển về DHCP rồi quét lại.',
  };
}

export async function waitForHost(ip: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const [probe] = await probeHosts({ hosts: [ip], ports: [80, 443, 631, 9100, 515], timeoutMs: 2000, concurrency: 5 });
    if (probe && Object.values(probe.ports).some((s) => s === 'open' || s === 'refused')) return true;
    await new Promise((r) => setTimeout(r, 3000));
  }
  return false;
}
