import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AutoConfigPanel } from '../components/AutoConfigPanel';
import { Button } from '../components/Button';
import { ChangeIpGuide } from '../components/ChangeIpGuide';
import { ConflictStatus } from '../components/ConflictStatus';
import { IpInput } from '../components/IpInput';
import { Pill, StatusBadge } from '../components/StatusBadge';
import { CONFIDENCE_LABEL, METHOD_LABEL, knownUsageFrom } from '../services/discovery/deviceStore';
import { canConfirmIp, decideConflict, type ProbeEvidence } from '../services/ip-management/conflictDecision';
import { collectConflictEvidence } from '../services/ip-management/runConflictCheck';
import { suggestIps } from '../services/ip-management/suggestIp';
import { isValidDhcpRange, type CandidateContext } from '../services/ip-management/validateIp';
import { classifySubnet } from '../services/network/subnetStatus';
import { adminUrl, checkReachability, type Reachability } from '../services/printer/reachability';
import { colors, font, mono, radius, spacing, TOUCH } from '../theme';
import type { DiscoveredDevice, PhoneNetwork, TargetNetwork } from '../types';
import { cidrNotation, fixedPrefixOctets, isValidIPv4, subnetOf } from '../utils/ipv4';

type Props = {
  device: DiscoveredDevice;
  allDevices: DiscoveredDevice[];
  network: PhoneNetwork | null;
  target: TargetNetwork | null;
  focusSuggestion: boolean;
  onBack: () => void;
  onOpenWeb: (url: string) => void;
  onUseCurrentNetworkAsTarget: () => void;
};

const AUTO_CHECK_DELAY_MS = 700;

export function PrinterDetailScreen({ device, allDevices, network, target, focusSuggestion, onBack, onOpenWeb, onUseCurrentNetworkAsTarget }: Props) {
  const insets = useSafeAreaInsets();
  const status = classifySubnet(network, device.ip);

  // ---- reachability / web admin ----
  const [reach, setReach] = useState<Reachability | null>(null);
  const [reachChecking, setReachChecking] = useState(false);
  const recheckReach = useCallback(async () => {
    setReachChecking(true);
    try {
      setReach(await checkReachability(device.ip));
    } finally {
      setReachChecking(false);
    }
  }, [device.ip]);
  useEffect(() => {
    recheckReach();
  }, [recheckReach]);
  const webUrl = adminUrl(device, reach);
  const webReason =
    reach == null
      ? 'Đang kiểm tra kết nối…'
      : reach.state === 'reachable'
        ? 'Máy in không mở cổng web 80/443.'
        : status === 'different'
          ? `${reach.reason} Máy in khác subnet: hãy làm theo bước 2 của hướng dẫn rồi kiểm tra lại.`
          : reach.reason;

  // ---- new IP suggestion + conflict check ----
  const [showSuggestion, setShowSuggestion] = useState(focusSuggestion || status === 'different');
  const [dhcpOpen, setDhcpOpen] = useState(false);
  const [dhcpStart, setDhcpStart] = useState('');
  const [dhcpEnd, setDhcpEnd] = useState('');
  const [excluded, setExcluded] = useState<string[]>([]);

  const ctx: CandidateContext | null = useMemo(() => {
    if (!target) return null;
    const range = { start: dhcpStart.trim(), end: dhcpEnd.trim() };
    const sameNetwork = network?.ipAddress && classifySubnet(target, network.ipAddress) === 'same';
    return {
      target,
      knownInUse: knownUsageFrom(allDevices),
      dhcpRange: isValidDhcpRange(range) ? range : null,
      dhcpServer: sameNetwork ? network?.dhcpServer : null,
    };
  }, [target, allDevices, dhcpStart, dhcpEnd, network]);

  const suggestion = useMemo(() => (ctx ? suggestIps(ctx, { exclude: excluded }) : null), [ctx, excluded]);
  const [candidate, setCandidate] = useState('');
  useEffect(() => {
    if (!candidate && suggestion?.suggestions[0]) setCandidate(suggestion.suggestions[0].ip);
  }, [candidate, suggestion]);

  const [probe, setProbe] = useState<{ ip: string; evidence: ProbeEvidence } | null>(null);
  const [checkingIp, setCheckingIp] = useState<string | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [confirmedIp, setConfirmedIp] = useState<string | null>(null);
  const checkToken = useRef(0);

  // Evidence is only used when it belongs to the address currently typed.
  const verdict = ctx ? decideConflict(candidate, ctx, probe?.ip === candidate.trim() ? probe.evidence : undefined) : null;

  const runCheck = useCallback(
    async (ip: string) => {
      if (!target) return;
      const token = ++checkToken.current;
      setCheckingIp(ip);
      const evidence = await collectConflictEvidence(ip, target, network);
      if (token !== checkToken.current) return; // the technician changed the IP meanwhile
      setProbe({ ip, evidence });
      setCheckingIp(null);
    },
    [target, network],
  );

  // Every edit drops the acknowledgement and any confirmation of a different address.
  useEffect(() => {
    setAcknowledged(false);
    setConfirmedIp((c) => (c === candidate ? c : null));
  }, [candidate]);

  // Every edit (or new scan evidence) cancels the old check and re-checks after a pause.
  useEffect(() => {
    checkToken.current++;
    setCheckingIp(null);
    if (!ctx || decideConflict(candidate, ctx).kind !== 'pending') return;
    const t = setTimeout(() => runCheck(candidate.trim()), AUTO_CHECK_DELAY_MS);
    return () => clearTimeout(t);
  }, [candidate, ctx]);

  const pickNextSuggestion = () => {
    const next = [...excluded, candidate];
    setExcluded(next);
    const s = ctx ? suggestIps(ctx, { exclude: next }).suggestions[0] : null;
    setCandidate(s?.ip ?? '');
  };

  // ---- guide / auto config ----
  const [panel, setPanel] = useState<'none' | 'guide' | 'auto'>('none');
  const [verifyResult, setVerifyResult] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const autoAvailable = reach?.state === 'reachable' && device.methods.includes('snmp');
  const autoReason = reach?.state !== 'reachable'
    ? 'Điện thoại chưa kết nối được tới máy in ở IP hiện tại.'
    : 'Máy in chưa trả lời SNMP – chưa có bằng chứng hỗ trợ cấu hình qua SNMP.';

  const verifyNewIp = async () => {
    if (!confirmedIp) return;
    setVerifying(true);
    try {
      const r = await checkReachability(confirmedIp);
      setVerifyResult(
        r.state === 'reachable'
          ? `✓ Có thiết bị trả lời tại ${confirmedIp} (cổng ${r.openPorts.join(', ') || 'TCP'}). Quét lại ở màn hình chính để xác nhận đó là máy in.`
          : `✗ Chưa có phản hồi tại ${confirmedIp}. ${r.state === 'unavailable' ? r.reason : 'Kiểm tra điện thoại đã về DHCP chưa, chờ máy in khởi động lại rồi thử lại.'}`,
      );
    } finally {
      setVerifying(false);
    }
  };

  const targetDiffersFromPhone = !!target && !!network?.ipAddress && classifySubnet(target, network.ipAddress) === 'different';
  const fixedPrefix = target ? fixedPrefixOctets(subnetOf(target.ipAddress, target.prefixLength)) : null;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.topBar}>
        <Pressable onPress={onBack} hitSlop={12} style={styles.back} accessibilityRole="button" accessibilityLabel="Quay lại">
          <Text style={styles.backText}>‹ Quay lại</Text>
        </Pressable>
        <Text style={styles.topTitle} numberOfLines={1}>
          {device.model ?? device.serviceName ?? device.ip}
        </Text>
      </View>

      <ScrollView contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + spacing.xl }]} keyboardShouldPersistTaps="handled">
        <Card title="Máy in">
          <Big label="IP hiện tại" value={device.ip} />
          <Row label="Model" value={device.model ?? 'Chưa xác định'} />
          <Row
            label="Hãng"
            value={
              device.manufacturer
                ? `${device.manufacturer}${device.manufacturerSource === 'oui' ? ' (đoán theo MAC, chưa chắc chắn)' : ''}`
                : 'Chưa xác định'
            }
          />
          <Row label="MAC" value={device.mac ?? 'Chưa xác định'} />
          <Row label="Tên" value={device.serviceName ?? device.hostname ?? 'Chưa xác định'} />
          <Row label="Cổng" value={device.openPorts.length ? device.openPorts.join(', ') : 'Chưa xác định'} />
          <Row label="Phát hiện" value={device.methods.map((m) => METHOD_LABEL[m]).join(', ')} />
          <Row label="Tin cậy" value={CONFIDENCE_LABEL[device.confidence]} />
          {device.evidence.slice(-4).map((e, i) => (
            <Text key={i} style={styles.evidence}>
              · {e.detail}
            </Text>
          ))}
        </Card>

        <Card title="Kết nối">
          <Row label="IP điện thoại" value={network?.ipAddress ? `${network.ipAddress}/${network.prefixLength ?? '?'}` : 'Không xác định'} />
          <Row label="Subnet đích" value={target ? cidrNotation(target.ipAddress, target.prefixLength) : 'Không xác định'} />
          <StatusBadge status={status} />
          <Text style={styles.small}>
            {status === 'same'
              ? 'Cùng subnet chưa chắc chắn kết nối được (tường lửa, cách ly Wi-Fi…).'
              : status === 'different'
                ? 'Khác subnet: điện thoại thường không mở được trang quản trị, trừ khi router có định tuyến giữa hai dải.'
                : 'Chưa đủ thông tin mạng để so sánh.'}
          </Text>
          <ReachLine reach={reach} checking={reachChecking} />
          <Button title="MỞ TRANG QUẢN TRỊ" onPress={() => webUrl && onOpenWeb(webUrl)} disabled={!webUrl} />
          {!webUrl ? <Text style={styles.warn}>{webReason}</Text> : null}
          <Button title="KIỂM TRA LẠI KẾT NỐI" variant="outline" onPress={recheckReach} loading={reachChecking} />
          {targetDiffersFromPhone ? (
            <View style={styles.tempBox}>
              <Text style={styles.warn}>
                Điện thoại đang ở mạng khác mạng đích ({network?.ipAddress}). Nếu bạn đã chuyển sang mạng cửa hàng mới, đặt lại mạng đích.
              </Text>
              <Button title="Dùng mạng hiện tại làm mạng đích" variant="outline" onPress={onUseCurrentNetworkAsTarget} />
            </View>
          ) : null}
        </Card>

        {!showSuggestion ? (
          <Button title="GỢI Ý IP MỚI" variant={status === 'different' ? 'danger' : 'outline'} onPress={() => setShowSuggestion(true)} />
        ) : (
          <Card title="IP mới cho máy in">
            {!target || !ctx ? (
              <Text style={styles.warn}>Chưa xác định được mạng đích. Kết nối Wi-Fi của cửa hàng (DHCP) rồi bấm Làm mới.</Text>
            ) : (
              <>
                <Text style={styles.small}>
                  Gợi ý: {suggestion?.suggestions.map((s) => s.ip + (s.inDhcpRange ? ' (trong dải DHCP)' : '')).join(', ') || '—'}
                </Text>
                {suggestion?.reason ? <Text style={styles.warn}>{suggestion.reason}</Text> : null}
                <IpInput value={candidate} fixedPrefix={fixedPrefix} onChange={setCandidate} />

                {verdict ? (
                  <ConflictStatus
                    verdict={verdict}
                    checking={checkingIp === candidate.trim()}
                    acknowledged={acknowledged}
                    onAcknowledge={setAcknowledged}
                    onRecheck={() => runCheck(candidate.trim())}
                  />
                ) : null}

                <Button
                  title="KIỂM TRA IP"
                  variant="outline"
                  onPress={() => runCheck(candidate.trim())}
                  disabled={!isValidIPv4(candidate.trim()) || verdict?.kind === 'invalid' || verdict?.kind === 'in-use'}
                  loading={checkingIp === candidate.trim()}
                />
                {verdict?.kind === 'in-use' || verdict?.kind === 'unverifiable' ? (
                  <Button title="DÙNG IP GỢI Ý KHÁC" variant="outline" onPress={pickNextSuggestion} />
                ) : null}

                {confirmedIp === candidate ? (
                  <Pill text={`ĐÃ CHỐT IP MỚI: ${confirmedIp}`} fg={colors.green} bg={colors.greenBg} />
                ) : (
                  <Button
                    title="XÁC NHẬN ĐỔI IP"
                    variant="success"
                    disabled={!verdict || !canConfirmIp(verdict, acknowledged)}
                    onPress={() => setConfirmedIp(candidate.trim())}
                  />
                )}

                <Pressable onPress={() => setDhcpOpen((v) => !v)} style={styles.linkBtn}>
                  <Text style={styles.linkText}>{dhcpOpen ? '▾' : '▸'} Dải DHCP của router (nếu biết)</Text>
                </Pressable>
                {dhcpOpen ? (
                  <View style={styles.dhcpRow}>
                    <TextInput value={dhcpStart} onChangeText={setDhcpStart} placeholder="Từ 192.168.1.100" keyboardType="numbers-and-punctuation" style={styles.dhcpInput} />
                    <TextInput value={dhcpEnd} onChangeText={setDhcpEnd} placeholder="Đến 192.168.1.199" keyboardType="numbers-and-punctuation" style={styles.dhcpInput} />
                  </View>
                ) : null}
              </>
            )}
          </Card>
        )}

        <Card title="Đổi IP máy in">
          {!confirmedIp ? <Text style={styles.small}>Hãy chốt IP mới (XÁC NHẬN ĐỔI IP) trước.</Text> : null}
          <Button
            title="HƯỚNG DẪN ĐỔI IP"
            variant={panel === 'guide' ? 'primary' : 'outline'}
            disabled={!confirmedIp}
            onPress={() => setPanel(panel === 'guide' ? 'none' : 'guide')}
          />
          {autoAvailable ? (
            <Button
              title="THỬ CẤU HÌNH TỰ ĐỘNG"
              variant={panel === 'auto' ? 'primary' : 'outline'}
              disabled={!confirmedIp}
              onPress={() => setPanel(panel === 'auto' ? 'none' : 'auto')}
            />
          ) : (
            <Text style={styles.small}>Cấu hình tự động: chưa khả dụng. {autoReason}</Text>
          )}

          {confirmedIp && target && panel === 'guide' ? (
            <ChangeIpGuide
              printerIp={device.ip}
              newIp={confirmedIp}
              target={target}
              subnetStatus={status}
              adminUrl={webUrl}
              adminUnavailableReason={webUrl ? null : webReason}
              verifying={verifying}
              verifyResult={verifyResult}
              onOpenAdmin={onOpenWeb}
              onRecheckReachability={recheckReach}
              onVerifyNewIp={verifyNewIp}
            />
          ) : null}
          {confirmedIp && target && panel === 'auto' && autoAvailable ? (
            <AutoConfigPanel printerIp={device.ip} newIp={confirmedIp} target={target} onApplied={() => setVerifyResult(null)} />
          ) : null}
        </Card>
      </ScrollView>
    </View>
  );
}

function ReachLine({ reach, checking }: { reach: Reachability | null; checking: boolean }) {
  if (checking || !reach) return <Pill text="ĐANG KIỂM TRA KẾT NỐI…" fg={colors.neutral} bg={colors.neutralBg} />;
  if (reach.state === 'reachable')
    return <Pill text={`KẾT NỐI ĐƯỢC · cổng mở: ${reach.openPorts.join(', ') || 'không'}`} fg={colors.green} bg={colors.greenBg} />;
  return <Pill text={reach.state === 'unavailable' ? 'KHÔNG KIỂM TRA ĐƯỢC' : 'CHƯA KẾT NỐI ĐƯỢC'} fg={colors.yellow} bg={colors.yellowBg} />;
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{title}</Text>
      {children}
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue} selectable>
        {value}
      </Text>
    </View>
  );
}

function Big({ label, value }: { label: string; value: string }) {
  return (
    <View>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.big} selectable>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    minHeight: TOUCH,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  back: { minHeight: TOUCH, justifyContent: 'center', paddingRight: spacing.sm },
  backText: { color: colors.primary, fontWeight: '800', fontSize: font.body },
  topTitle: { flex: 1, fontSize: font.body, fontWeight: '800', color: colors.text },
  body: { padding: spacing.lg, gap: spacing.lg },
  card: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, gap: spacing.md },
  cardTitle: { fontSize: font.body, fontWeight: '900', color: colors.text, textTransform: 'uppercase', letterSpacing: 0.5 },
  row: { flexDirection: 'row', gap: spacing.sm },
  rowLabel: { width: 96, fontSize: font.small, color: colors.textMuted },
  rowValue: { flex: 1, fontSize: font.small, color: colors.text, fontWeight: '600' },
  big: { fontSize: font.big, fontWeight: '900', color: colors.text, ...mono },
  evidence: { fontSize: font.tiny, color: colors.textMuted },
  small: { fontSize: font.small, color: colors.textMuted, lineHeight: 20 },
  warn: { fontSize: font.small, color: colors.yellow, lineHeight: 20, fontWeight: '600' },
  tempBox: { gap: spacing.sm, backgroundColor: colors.yellowBg, padding: spacing.md, borderRadius: radius.sm },
  linkBtn: { minHeight: 44, justifyContent: 'center' },
  linkText: { color: colors.primary, fontWeight: '700' },
  dhcpRow: { gap: spacing.sm },
  dhcpInput: {
    minHeight: TOUCH,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    fontSize: font.body,
    color: colors.text,
    ...mono,
  },
});
