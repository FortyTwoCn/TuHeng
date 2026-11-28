import type { EditorTheme } from '../../theme';

export const sceneColors = {
  light: {
    background: ['#f7fbfd', '#e0ebf1'],
    solid: {
      lightness: 44,
      lightRange: 34,
      highlight: '185 86% 32%',
      edge: '#1b3b4f',
      translucentEdge: '#284b62b8',
      wire: '#284e65',
    },
    spatial: {
      roles: { PROBLEM: '#244b9a', ANSWER: '#97490d', CONSTRUCTION: '#506a7c' },
      planes: { V: '#2c65a4', H: '#147d71', W: '#784caa' },
      rayOpacity: '70',
      projected: '#55758ab8',
      axis: '#25364b',
      linked: '#036e7f',
      halo: '#f3faff',
    },
  },
  dark: {
    background: ['#263f50', '#10222e'],
    solid: {
      lightness: 50,
      lightRange: 30,
      highlight: '174 76% 62%',
      edge: '#c7e3ef',
      translucentEdge: '#9ccce5c2',
      wire: '#b9def4',
    },
    spatial: {
      roles: { PROBLEM: '#93bcff', ANSWER: '#ffb776', CONSTRUCTION: '#adc3d2' },
      planes: { V: '#80b8f4', H: '#70d9cb', W: '#c6a7f0' },
      rayOpacity: '99',
      projected: '#adc8dad0',
      axis: '#e0eef5',
      linked: '#6bfff0',
      halo: '#132632',
    },
  },
};

export function paintSceneBackground(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  theme: EditorTheme,
) {
  const [center, edge] = sceneColors[theme].background;
  const x = width * 0.48;
  const y = height * 0.43;
  const gradient = context.createRadialGradient(x, y, 0, x, y, Math.hypot(width, height) * 0.62);
  gradient.addColorStop(0, center);
  gradient.addColorStop(1, edge);
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);
}
