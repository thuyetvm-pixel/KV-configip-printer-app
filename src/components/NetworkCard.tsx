import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, font, mono, radius, spacing } from '../theme';
import type { PhoneNetwork } from '../types';

type Props = {
  network: PhoneNetwork | null;
  onRefresh: () => void;
  onRequestPermission: () => void;
};

const UNKNOWN = 'Không xác định';

export function NetworkCard({ network, onRefresh, onRequestPermission }: Props) {
  const ip = network?.ipAddress ? `${network.ipAddress}/${network.prefixLength ?? '?'}` : UNKNOWN;
  const needsPermission = network && network.locationPermission !== 'granted' && network.locationPermission !== 'not-needed';

  return (
    <View style={styles.wrap}>
      <View style={styles.titleRow}>
        <Text style={styles.appName}>Printer Scanner</Text>
        <Pressable onPress={onRefresh} hitSlop={12} style={styles.refresh} accessibilityRole="button">
          <Text style={styles.refreshText}>Làm mới</Text>
        </Pressable>
      </View>

      <Line label="Wi-Fi" value={network?.ssid ?? UNKNOWN} />
      <Line label="IP điện thoại" value={ip} big />
      <Line label="Gateway" value={network?.gateway ?? UNKNOWN} />
      {network?.subnetMask ? <Line label="Subnet mask" value={network.subnetMask} /> : null}
      <Text style={styles.meta}>
        Android {network?.sdkInt ? `API ${network.sdkInt}` : UNKNOWN} · Quyền Vị trí:{' '}
        {network?.locationPermission === 'granted' ? 'đã cấp' : network?.locationPermission === 'not-needed' ? 'không cần' : 'chưa cấp'}
      </Text>

      {network?.issues.map((issue) => (
        <Text key={issue} style={styles.issue}>
          ⚠ {issue}
        </Text>
      ))}
      {needsPermission ? (
        <Pressable onPress={onRequestPermission} style={styles.permBtn} accessibilityRole="button">
          <Text style={styles.permText}>
            {network!.locationPermission === 'blocked' ? 'Mở Cài đặt để cấp quyền Vị trí' : 'Cấp quyền Vị trí để đọc tên Wi-Fi'}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function Line({ label, value, big }: { label: string; value: string; big?: boolean }) {
  return (
    <View style={styles.line}>
      <Text style={styles.label}>{label}:</Text>
      <Text style={[styles.value, big && styles.valueBig]} numberOfLines={1} adjustsFontSizeToFit selectable>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: colors.headerBg,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
    borderBottomLeftRadius: radius.lg,
    borderBottomRightRadius: radius.lg,
    gap: 4,
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  appName: { color: colors.headerText, fontSize: font.title, fontWeight: '900' },
  refresh: { borderWidth: 1, borderColor: colors.headerMuted, borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 8 },
  refreshText: { color: colors.headerText, fontWeight: '700' },
  line: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  label: { color: colors.headerMuted, fontSize: font.small, width: 104 },
  value: { flex: 1, color: colors.headerText, fontSize: font.body, fontWeight: '700', ...mono },
  valueBig: { fontSize: 22 },
  meta: { color: colors.headerMuted, fontSize: font.tiny, marginTop: 4 },
  issue: { color: '#FCD34D', fontSize: font.small, marginTop: 4, lineHeight: 19 },
  permBtn: { marginTop: 8, backgroundColor: '#FCD34D', borderRadius: radius.sm, paddingVertical: 10, alignItems: 'center' },
  permText: { color: '#3B2F00', fontWeight: '800' },
});
