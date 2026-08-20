export const THEMES = {
  ember: {
    accent: "#f6ad55",
    accentSoft: "#dd6b20",
    success: "#68d391",
    warning: "#f6e05e",
    danger: "#fc8181",
    info: "#90cdf4",
    muted: "#718096",
    border: "#4a5568",
  },
  ocean: {
    accent: "#63b3ed",
    accentSoft: "#3182ce",
    success: "#68d391",
    warning: "#f6e05e",
    danger: "#fc8181",
    info: "#9f7aea",
    muted: "#718096",
    border: "#4a5568",
  },
  forest: {
    accent: "#68d391",
    accentSoft: "#38a169",
    success: "#9ae6b4",
    warning: "#f6e05e",
    danger: "#fc8181",
    info: "#90cdf4",
    muted: "#718096",
    border: "#4a5568",
  },
  violet: {
    accent: "#b794f4",
    accentSoft: "#805ad5",
    success: "#68d391",
    warning: "#f6e05e",
    danger: "#fc8181",
    info: "#90cdf4",
    muted: "#718096",
    border: "#4a5568",
  },
};

export function resolveTheme(name) {
  const normalized = String(name || "").toLowerCase();
  const aliases = { orange: "ember", blue: "ocean", green: "forest", purple: "violet" };
  return { name: THEMES[normalized] ? normalized : aliases[normalized] || "ember", colors: THEMES[THEMES[normalized] ? normalized : aliases[normalized] || "ember"] };
}

export function contextColor(used, total, theme) {
  if (!total || total <= 0) return theme.muted;
  const ratio = used / total;
  if (ratio >= 0.85) return theme.danger;
  if (ratio >= 0.6) return theme.warning;
  return theme.success;
}
