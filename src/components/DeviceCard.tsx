import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { CONFIDENCE_LABEL, METHOD_LABEL } from '../services/discovery/deviceStore';
import { colors, font, mono, radius, spacing } from '../theme';
import type { DiscoveredDevice, SubnetStatus } from '../types';
import { StatusBadge } from './StatusBadge';

type Props = { device: DiscoveredDevice; status: SubnetStatus; onPress: () => void };

export function DeviceCard({ device, status, onPress }: Props) {
  const different = status === 'different';
  const title = device.model ?? device.serviceName ?? device.hostname ?? 'Chưa xác định model';
  const icon = device.confidence === 'confirmed' || device.confidence === 'likely' ? 'printer' : 'help-network-outline';

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${title}, IP ${device.ip}`}
      style={({ pressed }) => [styles.card, different && styles.cardDanger, pressed && { opacity: 0.85 }]}
    >
      <View style={styles.row}>
        <View style={[styles.iconBox, different && { backgroundColor: colors.redBg }]}>
          <MaterialCommunityIcons name={icon} size={30} color={different ? colors.red : colors.primary} />
        </View>
        <View style={styles.main}>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          <Text style={styles.ip} selectable>
            {device.ip}
          </Text>
          <Text style={styles.mac}>MAC: {device.mac ?? 'Chưa xác định'}</Text>
        </View>
      </View>

      <View style={styles.footer}>
        <StatusBadge status={status} />
        <Text style={styles.meta} numberOfLines={1}>
          {CONFIDENCE_LABEL[device.confidence]} · {device.methods.map((m) => METHOD_LABEL[m]).join(' + ')}
        </Text>
      </View>
      <Text style={styles.detail}>CHI TIẾT ›</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.md,
  },
  cardDanger: { borderColor: colors.red, borderWidth: 2, borderLeftWidth: 8, backgroundColor: '#FFF7F7' },
  row: { flexDirection: 'row', gap: spacing.md, alignItems: 'center' },
  iconBox: {
    width: 52,
    height: 52,
    borderRadius: radius.md,
    backgroundColor: colors.neutralBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  main: { flex: 1, gap: 2 },
  title: { fontSize: font.body, fontWeight: '700', color: colors.text },
  ip: { fontSize: 24, fontWeight: '900', color: colors.text, ...mono },
  mac: { fontSize: font.tiny, color: colors.textMuted, ...mono },
  footer: { gap: 6 },
  meta: { fontSize: font.tiny, color: colors.textMuted },
  detail: { position: 'absolute', right: spacing.lg, bottom: spacing.md, color: colors.primary, fontWeight: '800', fontSize: font.tiny },
});
