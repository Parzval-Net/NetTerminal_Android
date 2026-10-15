export const isMac = /Mac|iPhone|iPad/.test(navigator.userAgent);

/**
 * Modificador de la app. En macOS es Cmd; en Windows/Linux es Ctrl+Shift para no
 * robarle a la terminal combinaciones como Ctrl+C, Ctrl+W o Ctrl+K.
 */
export function isMod(e: KeyboardEvent): boolean {
  return isMac ? e.metaKey && !e.ctrlKey : e.ctrlKey && e.shiftKey && !e.metaKey;
}

export const modLabel = isMac ? "⌘" : "Ctrl+Shift+";
export const zoomLabel = isMac ? "⌘" : "Ctrl+Shift+";

export type AppAction =
  | "settings"
  | "notes"
  | "duplicateTab"
  | "tools"
  | "commands"
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

  // Zoom: Cmd + = - 0 en macOS; Ctrl+Shift en Windows/Linux para no capturar Ctrl+- (^_,
  // deshacer en readline/emacs) ni Ctrl+0, que la terminal sí usa. Se mira e.code porque con
  // Shift la tecla cambia de carácter según la distribución.
  const zoomMod = isMac ? e.metaKey : e.ctrlKey && e.shiftKey && !e.altKey;
  if (zoomMod && (e.code === "Equal" || e.code === "NumpadAdd" || key === "+")) return "zoomIn";
  if (zoomMod && (e.code === "Minus" || e.code === "NumpadSubtract")) return "zoomOut";
  if (zoomMod && (e.code === "Digit0" || e.code === "Numpad0")) return "zoomReset";

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
    case "l":
      return "commands";
    case "f":
      return "find";
    default:
      return null;
  }
}

/** Catálogo de comandos del sistema donde corre la app (para la terminal local). */
export const localOsVendor = (): string =>
  isMac ? "macos" : /Windows/i.test(navigator.userAgent) ? "windows" : "linux";
