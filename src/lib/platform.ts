export const isMac = /Mac|iPhone|iPad/.test(navigator.userAgent);

/**
 * Modificador de la app. En macOS es Cmd; en Windows/Linux es Ctrl+Shift para no
 * robarle a la terminal combinaciones como Ctrl+C, Ctrl+W o Ctrl+K.
 */
export function isMod(e: KeyboardEvent): boolean {
  return isMac ? e.metaKey && !e.ctrlKey : e.ctrlKey && e.shiftKey && !e.metaKey;
}

export const modLabel = isMac ? "⌘" : "Ctrl+Shift+";
export const zoomLabel = isMac ? "⌘" : "Ctrl+";

export type AppAction =
  | "settings"
  | "notes"
  | "duplicateTab"
  | "tools"
  | "palette"
  | "newTab"
  | "closeTab"
  | "newSession"
  | "toggleSidebar"
  | "find"
  | "nextTab"
  | "prevTab"
  | "zoomIn"
  | "zoomOut"
  | "zoomReset"
  | { tab: number };

/** Traduce un evento de teclado a una acción de la app (o null si es para la terminal). */
export function shortcutFor(e: KeyboardEvent): AppAction | null {
  if (e.type !== "keydown") return null;
  const key = e.key.toLowerCase();

  if (e.ctrlKey && key === "tab") return e.shiftKey ? "prevTab" : "nextTab";

  // Zoom: Cmd/Ctrl + = - 0 (sin Shift obligatorio en Windows/Linux)
  const zoomMod = isMac ? e.metaKey : e.ctrlKey && !e.altKey;
  if (zoomMod && (key === "=" || key === "+")) return "zoomIn";
  if (zoomMod && key === "-") return "zoomOut";
  if (zoomMod && key === "0") return "zoomReset";

  if (isMac && e.metaKey && /^[1-9]$/.test(key)) return { tab: Number(key) - 1 };
  if ((isMac ? e.metaKey : e.ctrlKey) && key === ",") return "settings";

  if (!isMod(e)) return null;
  switch (key) {
    case "k":
    case "p":
      return "palette";
    case "t":
      return "newTab";
    case "w":
      return "closeTab";
    case "n":
      return "newSession";
    case "b":
      return "toggleSidebar";
    case "j":
      return "notes";
    case "d":
      return "duplicateTab";
    case "e":
      return "tools";
    case "f":
      return "find";
    default:
      return null;
  }
}
