import type { PortState } from '../../types';
import { validateCandidate, type CandidateContext, type ValidationIssue } from './validateIp';

/** What the network check observed for one candidate address. */
export type ProbeEvidence = {
  /** The phone currently sits in the target subnet (otherwise probing says nothing) */
  phoneOnTargetNetwork: boolean;
  /** TCP connect result per port; null when the probe could not run */
  tcp: Record<number, PortState> | null;
  /** Complete ARP entry for the address (Android 9 and older only) */
  arpMac?: string | null;
  arpAvailable: boolean;
  snmpAnswered: boolean;
  probeError?: string;
};

export type ConflictVerdict =
  /** Static checks failed: the address can never be used here */
  | { kind: 'invalid'; ip: string; issues: ValidationIssue[] }
  /** A. Confirmed in use – confirming is locked */
  | { kind: 'in-use'; ip: string; reasons: string[]; warnings: string[] }
  /** Static checks passed, network check not run yet for this exact address */
  | { kind: 'pending'; ip: string; warnings: string[] }
  /** B. Nothing answered – not an absolute guarantee */
  | { kind: 'no-conflict-found'; ip: string; evidence: string[]; caveats: string[]; warnings: string[] }
  /** C. Could not tell */
  | { kind: 'unverifiable'; ip: string; reasons: string[]; warnings: string[] };

const NULL_MACS = new Set(['00:00:00:00:00:00', '']);

export const CHECK_CAVEATS = [
  'Thiết bị đang tắt, đang ngủ hoặc chặn mọi kết nối vẫn có thể đã được gán IP này.',
  'Wi-Fi bật "cách ly thiết bị" (AP isolation) có thể che các thiết bị khác.',
];

function warningsOf(issues: ValidationIssue[]): string[] {
  return issues.filter((i) => i.kind === 'warning').map((i) => i.message);
}

/**
 * Combines the offline validation with what the network check observed. Pure function, so a
 * stale probe can never leak in: the caller passes the evidence collected for `ip` only.
 */
export function decideConflict(ip: string, ctx: CandidateContext, probe?: ProbeEvidence): ConflictVerdict {
  const candidate = ip.trim();
  const issues = validateCandidate(candidate, ctx);
  const warnings = warningsOf(issues);

  const invalid = issues.filter((i) => i.kind === 'invalid');
  if (invalid.length) return { kind: 'invalid', ip: candidate, issues: invalid };

  const inUse = issues.filter((i) => i.kind === 'in-use').map((i) => i.message);
  if (inUse.length) return { kind: 'in-use', ip: candidate, reasons: inUse, warnings };

  if (!probe) return { kind: 'pending', ip: candidate, warnings };

  if (!probe.phoneOnTargetNetwork) {
    return {
      kind: 'unverifiable',
      ip: candidate,
      reasons: ['Điện thoại hiện không ở trong subnet đích nên không dò được IP này. Hãy kết nối lại Wi-Fi của mạng đích (DHCP).'],
      warnings,
    };
  }
  if (probe.probeError || !probe.tcp) {
    return { kind: 'unverifiable', ip: candidate, reasons: [probe.probeError ?? 'Không chạy được phép dò TCP.'], warnings };
  }

  const reasons: string[] = [];
  const answered = Object.entries(probe.tcp).filter(([, s]) => s === 'open' || s === 'refused');
  if (answered.length) {
    const ports = answered.map(([p, s]) => `${p} (${s === 'open' ? 'mở' : 'từ chối'})`).join(', ');
    reasons.push(`Có thiết bị trả lời TCP tại cổng ${ports}.`);
  }
  if (probe.arpMac && !NULL_MACS.has(probe.arpMac)) {
    reasons.push(`Bảng ARP có thiết bị MAC ${probe.arpMac} đang giữ IP này.`);
  }
  if (probe.snmpAnswered) reasons.push('Có thiết bị trả lời SNMP tại IP này.');
  if (reasons.length) return { kind: 'in-use', ip: candidate, reasons, warnings };

  const states = Object.values(probe.tcp);
  const unreachable = states.includes('unreachable');
  const allTimeout = states.length > 0 && states.every((s) => s === 'timeout');

  if (unreachable) {
    const evidence = ['Không thiết bị nào trả lời ARP cho IP này (EHOSTUNREACH).'];
    if (probe.arpAvailable) evidence.push('Bảng ARP không có mục nào cho IP này.');
    return { kind: 'no-conflict-found', ip: candidate, evidence, caveats: CHECK_CAVEATS, warnings };
  }
  if (allTimeout) {
    return {
      kind: 'unverifiable',
      ip: candidate,
      reasons: [
        'Mọi cổng đều hết thời gian chờ: có thể có thiết bị đang giữ IP nhưng chặn kết nối, hoặc mạng lọc gói tin.',
      ],
      warnings,
    };
  }
  return {
    kind: 'unverifiable',
    ip: candidate,
    reasons: ['Phép dò TCP trả về lỗi không xác định.'],
    warnings,
  };
}

/** The confirm button may only be enabled for a no-conflict verdict the technician acknowledged. */
export function canConfirmIp(verdict: ConflictVerdict, acknowledged: boolean): boolean {
  return verdict.kind === 'no-conflict-found' && acknowledged;
}
