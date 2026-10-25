import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { ConflictVerdict } from '../services/ip-management/conflictDecision';
import { colors, font, radius, spacing } from '../theme';
import { Button } from './Button';

type Props = {
  verdict: ConflictVerdict;
  checking: boolean;
  acknowledged: boolean;
  onAcknowledge: (v: boolean) => void;
  onRecheck: () => void;
};

export function ConflictStatus({ verdict, checking, acknowledged, onAcknowledge, onRecheck }: Props) {
  if (checking) {
    return (
      <Box fg={colors.neutral} bg={colors.neutralBg} title="ĐANG KIỂM TRA IP…">
        <Item text={`Đang dò ${verdict.ip} (TCP, SNMP, ARP nếu có). Mất khoảng 5 giây.`} />
      </Box>
    );
  }

  switch (verdict.kind) {
    case 'invalid':
      return (
        <Box fg={colors.red} bg={colors.redBg} title="IP KHÔNG HỢP LỆ">
          {verdict.issues.map((i) => (
            <Item key={i.code} text={i.message} />
          ))}
        </Box>
      );
    case 'in-use':
      return (
        <Box fg={colors.red} bg={colors.redBg} title="IP NÀY ĐANG ĐƯỢC SỬ DỤNG">
          {verdict.reasons.map((r) => (
            <Item key={r} text={r} />
          ))}
          <Warnings list={verdict.warnings} />
          <Text style={[styles.note, { color: colors.red }]}>Không thể đổi máy in sang IP này. Hãy chọn IP khác.</Text>
        </Box>
      );
    case 'pending':
      return (
        <Box fg={colors.neutral} bg={colors.neutralBg} title="CHƯA KIỂM TRA TRÊN MẠNG">
          <Item text="IP hợp lệ về định dạng và subnet. Bấm KIỂM TRA IP để dò trùng trên mạng." />
          <Warnings list={verdict.warnings} />
        </Box>
      );
    case 'no-conflict-found':
      return (
        <Box fg={colors.green} bg={colors.greenBg} title="CHƯA PHÁT HIỆN TRÙNG IP">
          {verdict.evidence.map((e) => (
            <Item key={e} text={e} />
          ))}
          <Warnings list={verdict.warnings} />
          <Text style={styles.caveatTitle}>Đây không phải bảo đảm tuyệt đối:</Text>
          {verdict.caveats.map((c) => (
            <Item key={c} text={c} muted />
          ))}
          <Pressable
            onPress={() => onAcknowledge(!acknowledged)}
            style={styles.ackRow}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: acknowledged }}
          >
            <View style={[styles.checkbox, acknowledged && styles.checkboxOn]}>
              {acknowledged ? <Text style={styles.checkmark}>✓</Text> : null}
            </View>
            <Text style={styles.ackText}>Tôi đã hiểu và xác nhận dùng IP {verdict.ip}</Text>
          </Pressable>
        </Box>
      );
    case 'unverifiable':
      return (
        <Box fg={colors.yellow} bg={colors.yellowBg} title="CHƯA THỂ XÁC MINH IP">
          {verdict.reasons.map((r) => (
            <Item key={r} text={r} />
          ))}
          <Warnings list={verdict.warnings} />
          <Text style={styles.note}>IP này KHÔNG được coi là còn trống. Kiểm tra lại hoặc nhập IP khác.</Text>
          <Button title="KIỂM TRA LẠI" variant="outline" onPress={onRecheck} />
        </Box>
      );
  }
}

function Box({ fg, bg, title, children }: { fg: string; bg: string; title: string; children: ReactNode }) {
  return (
    <View style={[styles.box, { backgroundColor: bg, borderColor: fg }]} accessibilityLiveRegion="polite">
      <Text style={[styles.title, { color: fg }]}>{title}</Text>
      {children}
    </View>
  );
}

function Item({ text, muted }: { text: string; muted?: boolean }) {
  return <Text style={[styles.item, muted && { color: colors.textMuted }]}>• {text}</Text>;
}

function Warnings({ list }: { list: string[] }) {
  return (
    <>
      {list.map((w) => (
        <Text key={w} style={[styles.item, { color: colors.yellow }]}>
          ⚠ {w}
        </Text>
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  box: { borderWidth: 2, borderRadius: radius.md, padding: spacing.md, gap: 6 },
  title: { fontSize: 17, fontWeight: '900', letterSpacing: 0.3 },
  item: { fontSize: font.small, color: colors.text, lineHeight: 20 },
  note: { fontSize: font.small, fontWeight: '700', color: colors.text },
  caveatTitle: { fontSize: font.tiny, fontWeight: '700', color: colors.textMuted, marginTop: 4 },
  ackRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 8, minHeight: 48 },
  checkbox: {
    width: 28,
    height: 28,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: colors.green,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  checkboxOn: { backgroundColor: colors.green },
  checkmark: { color: colors.onPrimary, fontWeight: '900', fontSize: 18 },
  ackText: { flex: 1, fontSize: font.small, fontWeight: '700', color: colors.text },
});
