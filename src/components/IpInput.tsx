import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors, font, mono, radius, spacing, TOUCH } from '../theme';

type Props = {
  value: string;
  /** "a.b.c" when the last octet alone identifies a host (prefix >= 24), else null */
  fixedPrefix: string | null;
  onChange: (ip: string) => void;
};

/**
 * Two ways to enter the address: just the last octet (192.168.1.[201]) when the subnet allows it,
 * or the full IPv4. Every edit is reported immediately so validation re-runs on each keystroke.
 */
export function IpInput({ value, fixedPrefix, onChange }: Props) {
  const octetModeAllowed = fixedPrefix != null && value.startsWith(`${fixedPrefix}.`);
  const [mode, setMode] = useState<'octet' | 'full'>(octetModeAllowed ? 'octet' : 'full');
  const effectiveMode = fixedPrefix ? mode : 'full';
  const octet = fixedPrefix && value.startsWith(`${fixedPrefix}.`) ? value.slice(fixedPrefix.length + 1) : '';

  useEffect(() => {
    if (!fixedPrefix) setMode('full');
  }, [fixedPrefix]);

  const setOctet = (raw: string) => onChange(`${fixedPrefix}.${raw.replace(/[^0-9]/g, '').slice(0, 3)}`);
  const step = (delta: number) => {
    const n = Number(octet);
    if (!Number.isInteger(n) || octet === '') return setOctet('1');
    setOctet(String(Math.min(254, Math.max(1, n + delta))));
  };

  return (
    <View style={styles.wrap}>
      {fixedPrefix ? (
        <View style={styles.segment}>
          {(['octet', 'full'] as const).map((m) => (
            <Pressable
              key={m}
              onPress={() => {
                setMode(m);
                if (m === 'octet' && !value.startsWith(`${fixedPrefix}.`)) onChange(`${fixedPrefix}.`);
              }}
              style={[styles.segmentItem, effectiveMode === m && styles.segmentActive]}
              accessibilityRole="button"
            >
              <Text style={[styles.segmentText, effectiveMode === m && styles.segmentTextActive]}>
                {m === 'octet' ? 'Sửa số cuối' : 'Nhập đầy đủ'}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {effectiveMode === 'octet' && fixedPrefix ? (
        <View style={styles.octetRow}>
          <Pressable onPress={() => step(-1)} style={styles.stepBtn} accessibilityLabel="Giảm số cuối">
            <Text style={styles.stepText}>−</Text>
          </Pressable>
          <Text style={styles.prefix} numberOfLines={1} adjustsFontSizeToFit>
            {fixedPrefix}.
          </Text>
          <TextInput
            value={octet}
            onChangeText={setOctet}
            keyboardType="number-pad"
            maxLength={3}
            style={styles.octetInput}
            selectTextOnFocus
            accessibilityLabel="Số cuối của IP"
          />
          <Pressable onPress={() => step(1)} style={styles.stepBtn} accessibilityLabel="Tăng số cuối">
            <Text style={styles.stepText}>+</Text>
          </Pressable>
        </View>
      ) : (
        <TextInput
          value={value}
          onChangeText={(t) => onChange(t.replace(/[^0-9.]/g, ''))}
          keyboardType="numbers-and-punctuation"
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="192.168.1.201"
          style={styles.fullInput}
          accessibilityLabel="Địa chỉ IPv4 mới"
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  segment: { flexDirection: 'row', backgroundColor: colors.neutralBg, borderRadius: radius.sm, padding: 3 },
  segmentItem: { flex: 1, paddingVertical: 10, borderRadius: 6, alignItems: 'center' },
  segmentActive: { backgroundColor: colors.surface },
  segmentText: { color: colors.textMuted, fontWeight: '700', fontSize: font.small },
  segmentTextActive: { color: colors.primary },
  octetRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  prefix: { flexShrink: 1, fontSize: 22, fontWeight: '800', color: colors.text, ...mono },
  octetInput: {
    width: 76,
    height: TOUCH,
    borderWidth: 2,
    borderColor: colors.primary,
    borderRadius: radius.sm,
    textAlign: 'center',
    fontSize: 24,
    fontWeight: '900',
    color: colors.text,
    backgroundColor: colors.surface,
    ...mono,
  },
  stepBtn: {
    width: TOUCH,
    height: TOUCH,
    borderRadius: radius.sm,
    backgroundColor: colors.neutralBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepText: { fontSize: 28, fontWeight: '700', color: colors.text },
  fullInput: {
    height: TOUCH,
    borderWidth: 2,
    borderColor: colors.primary,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    fontSize: 22,
    fontWeight: '800',
    color: colors.text,
    backgroundColor: colors.surface,
    ...mono,
  },
});
