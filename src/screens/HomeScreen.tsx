import { useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '../components/Button';
import { DeviceCard } from '../components/DeviceCard';
import { NetworkCard } from '../components/NetworkCard';
import { isPrinterResult } from '../services/discovery/deviceStore';
import { scanPreflight } from '../services/network/buildPhoneNetwork';
import { classifySubnet } from '../services/network/subnetStatus';
import { colors, font, mono, radius, spacing, TOUCH } from '../theme';
import type { DiscoveredDevice, PhoneNetwork, ScanProgress, TargetNetwork } from '../types';
import { isValidIPv4 } from '../utils/ipv4';

type Filter = 'all' | 'different' | 'same';

type Props = {
  network: PhoneNetwork | null;
  target: TargetNetwork | null;
  devices: DiscoveredDevice[];
  scanning: boolean;
  progress: ScanProgress | null;
  scanError: string | null;
  scanNotes: string[];
  logs: string[];
  onRefreshNetwork: () => void;
  onRequestPermission: () => void;
  onStartScan: () => void;
  onStopScan: () => void;
  onAddManualIp: (ip: string) => Promise<void>;
  onOpenDevice: (ip: string, focusSuggestion: boolean) => void;
};

export function HomeScreen(p: Props) {
  const insets = useSafeAreaInsets();
  const [filter, setFilter] = useState<Filter>('all');
  const [showNonPrinters, setShowNonPrinters] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualIp, setManualIp] = useState('');
  const [manualBusy, setManualBusy] = useState(false);
  const [showLogs, setShowLogs] = useState(false);

  const preflight = scanPreflight(p.network);
  // Subnet status is always judged against the phone's current network.
  const statusOf = (d: DiscoveredDevice) => classifySubnet(p.network, d.ip);

  const printers = useMemo(
    () => p.devices.filter((d) => showNonPrinters || isPrinterResult(d)),
    [p.devices, showNonPrinters],
  );
  const counts = {
    all: printers.length,
    different: printers.filter((d) => statusOf(d) === 'different').length,
    same: printers.filter((d) => statusOf(d) === 'same').length,
  };
  const visible = printers
    .filter((d) => filter === 'all' || statusOf(d) === filter)
    // Different-subnet printers first: they are what the technician came for.
    .sort((a, b) => Number(statusOf(b) === 'different') - Number(statusOf(a) === 'different'));
  const hiddenCount = p.devices.length - p.devices.filter(isPrinterResult).length;
  const printerCount = p.devices.filter((d) => d.confidence === 'confirmed' || d.confidence === 'likely').length;

  const addManual = async () => {
    setManualBusy(true);
    try {
      await p.onAddManualIp(manualIp.trim());
      setManualIp('');
      setManualOpen(false);
    } finally {
      setManualBusy(false);
    }
  };

  const header = (
    <View style={styles.controls}>
      {p.scanning ? (
        <>
          <Button title="DỪNG QUÉT" variant="danger" onPress={p.onStopScan} />
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${Math.round((p.progress?.fraction ?? 0) * 100)}%` }]} />
          </View>
          <Text style={styles.progressText}>{p.progress?.message ?? 'Đang chuẩn bị…'}</Text>
        </>
      ) : (
        <Button title="BẮT ĐẦU QUÉT MẠNG" onPress={p.onStartScan} disabled={!preflight.canScan} style={styles.bigButton} />
      )}
      {!p.scanning && !preflight.canScan ? (
        <Text style={styles.blocker}>Chưa quét được: {preflight.blockers.map((b) => b.message).join(' ')}</Text>
      ) : null}
      {p.scanError ? <Text style={styles.blocker}>{p.scanError}</Text> : null}
      {p.scanNotes.map((n) => (
        <Text key={n} style={styles.note}>
          ℹ {n}
        </Text>
      ))}

      <Text style={styles.total}>
        Phát hiện: {printerCount} máy in
        {counts.different ? <Text style={{ color: colors.red }}> · {counts.different} khác subnet</Text> : null}
      </Text>

      <View style={styles.filters}>
        {(
          [
            ['all', 'Tất cả'],
            ['different', 'Khác subnet'],
            ['same', 'Cùng subnet'],
          ] as const
        ).map(([key, label]) => (
          <Pressable
            key={key}
            onPress={() => setFilter(key)}
            style={[styles.filter, filter === key && styles.filterActive, key === 'different' && filter === key && styles.filterDanger]}
            accessibilityRole="tab"
            accessibilityState={{ selected: filter === key }}
          >
            <Text style={[styles.filterText, filter === key && styles.filterTextActive]} numberOfLines={1}>
              {label} ({counts[key]})
            </Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.toggleRow}>
        <Text style={styles.toggleLabel}>Hiện cả thiết bị chưa rõ là máy in{hiddenCount ? ` (${hiddenCount})` : ''}</Text>
        <Switch value={showNonPrinters} onValueChange={setShowNonPrinters} />
      </View>

      {manualOpen ? (
        <View style={styles.manualBox}>
          <Text style={styles.manualHint}>
            Nhập IP in trên trang cấu hình mạng của máy in (Network Configuration Report). Ứng dụng sẽ thử kết nối; nếu không có phản hồi,
            thiết bị được đánh dấu “Chưa xác minh”.
          </Text>
          <TextInput
            value={manualIp}
            onChangeText={(t) => setManualIp(t.replace(/[^0-9.]/g, ''))}
            placeholder="10.0.0.100"
            keyboardType="numbers-and-punctuation"
            style={styles.manualInput}
          />
          <Button title="THÊM & KIỂM TRA" onPress={addManual} disabled={!isValidIPv4(manualIp.trim())} loading={manualBusy} />
        </View>
      ) : (
        <Pressable onPress={() => setManualOpen(true)} style={styles.linkBtn} accessibilityRole="button">
          <Text style={styles.linkText}>+ Thêm máy in theo IP đã biết</Text>
        </Pressable>
      )}
    </View>
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <FlatList
        data={visible}
        keyExtractor={(d) => d.ip}
        ListHeaderComponent={
          <>
            <NetworkCard network={p.network} onRefresh={p.onRefreshNetwork} onRequestPermission={p.onRequestPermission} />
            {p.target && p.network?.ipAddress && classifySubnet(p.target, p.network.ipAddress) === 'different' ? (
              <Text style={styles.targetBanner}>
                Điện thoại đang ở mạng tạm. Mạng đích vẫn là {p.target.ipAddress}/{p.target.prefixLength}.
              </Text>
            ) : null}
            {header}
          </>
        }
        contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xl, gap: spacing.md }}
        renderItem={({ item }) => {
          const status = statusOf(item);
          return (
            <View style={styles.item}>
              <DeviceCard device={item} status={status} onPress={() => p.onOpenDevice(item.ip, false)} />
              {status === 'different' ? (
                <Button title="GỢI Ý IP MỚI" variant="danger" onPress={() => p.onOpenDevice(item.ip, true)} style={styles.suggestBtn} />
              ) : null}
            </View>
          );
        }}
        ListEmptyComponent={
          <Text style={styles.empty}>
            {p.scanning
              ? 'Đang dò… Kết quả sẽ hiện ngay khi có thiết bị trả lời.'
              : p.devices.length
                ? 'Không có thiết bị trong bộ lọc này.'
                : 'Chưa có kết quả. Kết nối Wi-Fi cùng mạng với máy in rồi bấm BẮT ĐẦU QUÉT MẠNG.'}
          </Text>
        }
        ListFooterComponent={
          p.logs.length ? (
            <View style={styles.logBox}>
              <Pressable onPress={() => setShowLogs((v) => !v)} style={{ minHeight: 40, justifyContent: 'center' }}>
                <Text style={styles.logTitle}>
                  {showLogs ? '▾' : '▸'} Nhật ký kỹ thuật ({p.logs.length})
                </Text>
              </Pressable>
              {showLogs
                ? p.logs.map((l, i) => (
                    <Text key={i} style={styles.logLine}>
                      {l}
                    </Text>
                  ))
                : null}
            </View>
          ) : undefined
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  controls: { padding: spacing.lg, gap: spacing.md },
  bigButton: { minHeight: 64 },
  progressTrack: { height: 8, backgroundColor: colors.border, borderRadius: 4, overflow: 'hidden' },
  progressFill: { height: 8, backgroundColor: colors.primary },
  progressText: { fontSize: font.small, color: colors.textMuted },
  blocker: { fontSize: font.small, color: colors.red, fontWeight: '700', lineHeight: 20 },
  note: { fontSize: font.small, color: colors.textMuted },
  total: { fontSize: font.title, fontWeight: '900', color: colors.text },
  filters: { flexDirection: 'row', gap: spacing.sm },
  filter: {
    flex: 1,
    minHeight: 44,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  filterActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  filterDanger: { backgroundColor: colors.red, borderColor: colors.red },
  filterText: { fontSize: 13, fontWeight: '700', color: colors.text },
  filterTextActive: { color: colors.onPrimary },
  toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  toggleLabel: { flex: 1, fontSize: font.small, color: colors.textMuted },
  linkBtn: { minHeight: 44, justifyContent: 'center' },
  linkText: { color: colors.primary, fontWeight: '800', fontSize: font.body },
  manualBox: { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, gap: spacing.sm, borderWidth: 1, borderColor: colors.border },
  manualHint: { fontSize: font.small, color: colors.textMuted, lineHeight: 20 },
  manualInput: {
    minHeight: TOUCH,
    borderWidth: 2,
    borderColor: colors.primary,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    fontSize: 20,
    fontWeight: '800',
    color: colors.text,
    ...mono,
  },
  targetBanner: {
    margin: spacing.lg,
    marginBottom: 0,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.yellowBg,
    color: colors.yellow,
    fontWeight: '700',
    overflow: 'hidden',
  },
  item: { paddingHorizontal: spacing.lg, gap: spacing.sm },
  suggestBtn: { minHeight: 56 },
  empty: { textAlign: 'center', color: colors.textMuted, marginHorizontal: spacing.xl, lineHeight: 22, fontSize: font.body },
  logBox: { margin: spacing.lg, padding: spacing.md, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, gap: 2 },
  logTitle: { fontWeight: '700', color: colors.text },
  logLine: { fontSize: 11, color: colors.textMuted, ...mono },
});
