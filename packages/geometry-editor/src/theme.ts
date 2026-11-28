import type { CSSProperties } from 'react';

export type EditorTheme = 'light' | 'dark';

// The native color input requires RGB values. Use the same defaults for the SVG inks.
export const draftingInk = {
  light: { ink: '#253b47', axis: '#688896', stem: '#245fa7' },
  dark: { ink: '#e7f1f4', axis: '#7c9ea9', stem: '#8dbbff' },
} satisfies Record<EditorTheme, { ink: string; axis: string; stem: string }>;

export function draftingThemeStyle(theme: EditorTheme): CSSProperties {
  const { ink, axis, stem } = draftingInk[theme];
  return { '--cad-ink': ink, '--cad-axis': axis, '--cad-stem': stem } as CSSProperties;
}
