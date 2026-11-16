// Hand-transcribed approximations of the user's U, peaked wave and shallow wave
// screenshot. These are synthetic CSS-pixel paths, not captured device samples.
const paths = {
  bowl: [
    [497, 326],
    [497, 340],
    [499, 356],
    [503, 369],
    [510, 382],
    [519, 392],
    [530, 398],
    [541, 401],
    [556, 400],
    [572, 399],
    [587, 397],
    [600, 390],
    [611, 381],
    [621, 370],
    [632, 358],
    [644, 347],
    [650, 335],
    [655, 324],
    [658, 314],
  ],
  peaked: [
    [615, 548],
    [621, 532],
    [630, 511],
    [642, 491],
    [655, 475],
    [669, 460],
    [683, 450],
    [692, 444],
    [699, 433],
    [706, 431],
    [712, 432],
    [723, 447],
    [738, 465],
    [750, 478],
    [763, 490],
    [774, 505],
    [783, 522],
    [792, 541],
    [802, 556],
    [812, 562],
    [824, 562],
    [837, 555],
    [848, 543],
    [859, 530],
    [869, 510],
    [878, 488],
    [887, 469],
    [894, 454],
    [898, 441],
  ],
  wave: [
    [1027, 345],
    [1038, 336],
    [1046, 334],
    [1055, 334],
    [1068, 340],
    [1083, 345],
    [1101, 352],
    [1115, 362],
    [1132, 377],
    [1148, 393],
    [1164, 410],
    [1181, 429],
    [1198, 446],
    [1214, 461],
    [1230, 474],
    [1246, 482],
    [1263, 488],
    [1276, 491],
    [1293, 491],
    [1308, 491],
    [1320, 481],
    [1333, 475],
    [1347, 465],
    [1358, 457],
    [1366, 447],
    [1373, 447],
  ],
} as const;
export type HandCurve = keyof typeof paths;
export function handDrawnCurve(shape: HandCurve, uneven = true, jitter = 0.55) {
  const path = paths[shape];
  const middle = {
    x: (Math.min(...path.map((p) => p[0])) + Math.max(...path.map((p) => p[0]))) / 2,
    y: (Math.min(...path.map((p) => p[1])) + Math.max(...path.map((p) => p[1]))) / 2,
  };
  const lengths = [0];
  for (let i = 1; i < path.length; i++)
    lengths.push(
      lengths[i - 1] + Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]),
    );
  return Array.from({ length: 181 }, (_, i) => {
    const at = (i / 180) ** (uneven ? 1.7 : 1) * lengths.at(-1)!;
    let j = 1;
    while (j < path.length - 1 && lengths[j] < at) j++;
    const t = (at - lengths[j - 1]) / (lengths[j] - lengths[j - 1]);
    const wobble = i === 0 || i === 180 ? 0 : jitter;
    return {
      x: path[j - 1][0] + (path[j][0] - path[j - 1][0]) * t - middle.x + wobble * Math.sin(i * 2.1),
      y: middle.y - path[j - 1][1] - (path[j][1] - path[j - 1][1]) * t + wobble * Math.cos(i * 1.7),
      pressure: 0.5,
    };
  });
}
