import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
export const colors = { ink: '#152C35', teal: '#096B62', mint: '#DEF0E9', paper: '#F5F6F2', line: '#D9E1DB', muted: '#58706F', amber: '#9B5811', danger: '#AB3434' };
export function Action({ title, onPress, secondary = false, disabled = false }: { title: string; onPress: () => void; secondary?: boolean; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress}
    style={({ pressed }) => [styles.button, secondary && styles.secondary, (disabled || pressed) && { opacity: 0.5 }]}>
    <Text style={[styles.buttonText, secondary && { color: colors.teal }]}>{title}</Text>
  </Pressable>;
}
export function Card({ children }: React.PropsWithChildren) { return <View style={styles.card}>{children}</View>; }
export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper }, content: { padding: 20, gap: 16, paddingBottom: 40 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  header: { paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.line, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  brand: { color: colors.ink, fontSize: 23, fontWeight: '900', letterSpacing: 3 },
  eyebrow: { color: colors.teal, fontSize: 11, letterSpacing: 2, fontWeight: '800' },
  title: { color: colors.ink, fontSize: 30, lineHeight: 36, fontWeight: '800' },
  heading: { color: colors.ink, fontSize: 19, fontWeight: '700' },
  body: { color: colors.muted, fontSize: 14, lineHeight: 21 },
  small: { color: colors.muted, fontSize: 12, lineHeight: 18 },
  card: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: colors.line, borderRadius: 18, padding: 18, gap: 12 },
  pill: { backgroundColor: colors.mint, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20 },
  pillText: { color: colors.teal, fontSize: 11, fontWeight: '800' },
  button: { backgroundColor: colors.teal, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 15, alignItems: 'center', minHeight: 48 },
  secondary: { backgroundColor: '#EDF3EF', borderWidth: 1, borderColor: colors.line },
  buttonText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
  error: { color: colors.danger, fontSize: 13, lineHeight: 20 },
  warning: { color: colors.amber, fontSize: 13, lineHeight: 20 },
  input: { color: colors.ink, backgroundColor: '#F8FAF7', borderWidth: 1, borderColor: colors.line, borderRadius: 10, padding: 13, fontSize: 16, minHeight: 49 },
});
