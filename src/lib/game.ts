export function fmtMoney(n: number): string {
  return `$${n.toLocaleString("en-US")}`;
}

// Map board space index -> 11x11 grid coordinates.
export function spacePos(index: number): { row: number; col: number } {
  if (index === 0) return { row: 10, col: 0 };
  if (index <= 10) return { row: 10, col: index };
  if (index <= 19) return { row: 20 - index, col: 10 };
  if (index <= 30) return { row: 0, col: 30 - index };
  return { row: index - 30, col: 0 };
}

export const GROUP_COLORS: Record<string, string> = {
  brown: "#7a4b2a",
  lightblue: "#9fd8ef",
  pink: "#d06aa8",
  orange: "#f28c28",
  red: "#e03c31",
  yellow: "#f4e231",
  green: "#2f9e44",
  darkblue: "#2563eb",
};

export const TOKEN_EMOJIS = ["🚢", "🐕", "✋", "👢", "🎩", "🐈", "🚗", "🛒"];

export function shortName(s: string): string {
  return s.length > 14 ? s.slice(0, 13) + "…" : s;
}
