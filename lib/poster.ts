function hashString(seed: string) {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash << 5) - hash + seed.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

// A small family of emerald-leaning duotone palettes so every generated
// poster feels part of the same brand while remaining visually distinct.
const PALETTES: [string, string, string][] = [
  ["#0d2b1c", "#14532d", "#22c55e"],
  ["#0a2621", "#0f6b52", "#34d399"],
  ["#111d13", "#166534", "#86efac"],
  ["#0c1f22", "#0e7490", "#5eead4"],
  ["#1a1206", "#a16207", "#facc15"],
  ["#1c0f1f", "#7e22ce", "#c4b5fd"],
  ["#1f0e0e", "#b91c1c", "#fca5a5"],
  ["#0f172a", "#1d4ed8", "#93c5fd"],
];

export function posterPalette(seed: string) {
  const hash = hashString(seed);
  const palette = PALETTES[hash % PALETTES.length];
  const angle = 25 + (hash % 70);
  const monogram = seed
    .split("-")
    .filter((w) => w.length > 2)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");
  return { palette, angle, monogram: monogram || seed.slice(0, 2).toUpperCase(), hash };
}
