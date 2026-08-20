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
  midnight: {
    accent: "#2dd4bf",
    accentSoft: "#0f766e",
    success: "#86efac",
    warning: "#fde047",
    danger: "#fb7185",
    info: "#67e8f9",
    muted: "#64748b",
    border: "#334155",
  },
  rose: {
    accent: "#f472b6",
    accentSoft: "#db2777",
    success: "#86efac",
    warning: "#facc15",
    danger: "#fb7185",
    info: "#c4b5fd",
    muted: "#94a3b8",
    border: "#4c1d3b",
  },
  mono: {
    accent: "#e5e7eb",
    accentSoft: "#9ca3af",
    success: "#d1d5db",
    warning: "#f3f4f6",
    danger: "#fca5a5",
    info: "#bfdbfe",
    muted: "#6b7280",
    border: "#4b5563",
  },
};

export const THEME_OPTIONS = [
  { id: "ember", label: "Ember", description: "Тёплый янтарный акцент" },
  { id: "ocean", label: "Ocean", description: "Спокойный синий акцент" },
  { id: "forest", label: "Forest", description: "Зелёный акцент для долгой работы" },
  { id: "violet", label: "Violet", description: "Контрастный фиолетовый акцент" },
  { id: "midnight", label: "Midnight", description: "Тёмный бирюзовый акцент" },
  { id: "rose", label: "Rose", description: "Яркий розовый акцент" },
  { id: "mono", label: "Mono", description: "Нейтральная монохромная тема" },
];

const THEME_ALIASES = { orange: "ember", blue: "ocean", green: "forest", purple: "violet", teal: "midnight", pink: "rose", gray: "mono", grey: "mono" };

export function normalizeTheme(name) {
  const normalized = String(name || "").trim().toLowerCase();
  return THEMES[normalized] ? normalized : THEME_ALIASES[normalized] || null;
}

export function resolveTheme(name) {
  const normalized = normalizeTheme(name) || "ember";
  return { name: normalized, colors: THEMES[normalized] };
}

export function contextColor(used, total, theme) {
  if (!total || total <= 0) return theme.muted;
  const ratio = used / total;
  if (ratio >= 0.85) return theme.danger;
  if (ratio >= 0.6) return theme.warning;
  return theme.success;
}
