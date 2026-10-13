import { useEffect, useState } from "react";
import type { ITheme } from "@xterm/xterm";

export interface TermPreset {
  id: string;
  name: string;
  dark: boolean;
  theme: ITheme;
}

/** Arma un ITheme a partir de fondo, texto, cursor, selección y los 16 colores ANSI. */
function t(bg: string, fg: string, cursor: string, sel: string, ansi: string[]): ITheme {
  const [black, red, green, yellow, blue, magenta, cyan, white] = ansi;
  const [bBlack, bRed, bGreen, bYellow, bBlue, bMagenta, bCyan, bWhite] = ansi.slice(8);
  return {
    background: bg,
    foreground: fg,
    cursor,
    cursorAccent: bg,
    selectionBackground: sel,
    black,
    red,
    green,
    yellow,
    blue,
    magenta,
    cyan,
    white,
    brightBlack: bBlack,
    brightRed: bRed,
    brightGreen: bGreen,
    brightYellow: bYellow,
    brightBlue: bBlue,
    brightMagenta: bMagenta,
    brightCyan: bCyan,
    brightWhite: bWhite,
  };
}

const solarizedAnsi = [
  "#073642", "#dc322f", "#859900", "#b58900", "#268bd2", "#d33682", "#2aa198", "#eee8d5",
  "#586e75", "#cb4b16", "#586e75", "#657b83", "#839496", "#6c71c4", "#93a1a1", "#fdf6e3",
];

// Paletas tomadas de las especificaciones públicas de cada tema.
export const presets: TermPreset[] = [
  {
    id: "nt-dark",
    name: "NetTerminal oscuro",
    dark: true,
    theme: t("#0e1116", "#d6dae0", "#7aa7ff", "rgba(122,167,255,0.30)", [
      "#1f242c", "#ef6b73", "#7ccf8a", "#e6c06b", "#6ea8fe", "#c49bf2", "#5fc8d6", "#d6dae0",
      "#5c6470", "#ff8a91", "#98e2a4", "#f2d38c", "#92bfff", "#d8b6ff", "#83dbe6", "#ffffff",
    ]),
  },
  {
    id: "nt-light",
    name: "NetTerminal claro",
    dark: false,
    theme: t("#ffffff", "#24292f", "#2563eb", "rgba(37,99,235,0.20)", [
      "#24292f", "#cf222e", "#116329", "#8a6100", "#0550ae", "#8250df", "#1b7c83", "#6e7781",
      "#57606a", "#a40e26", "#1a7f37", "#9a6700", "#0969da", "#a475f9", "#3192aa", "#8c959f",
    ]),
  },
  {
    id: "classic",
    name: "Clásico",
    dark: true,
    theme: t("#000000", "#c0c0c0", "#c0c0c0", "rgba(192,192,192,0.35)", [
      "#000000", "#cd0000", "#00cd00", "#cdcd00", "#0000ee", "#cd00cd", "#00cdcd", "#e5e5e5",
      "#7f7f7f", "#ff0000", "#00ff00", "#ffff00", "#5c5cff", "#ff00ff", "#00ffff", "#ffffff",
    ]),
  },
  {
    id: "phosphor",
    name: "Fósforo verde",
    dark: true,
    theme: t("#0a0f0a", "#33ff66", "#33ff66", "rgba(51,255,102,0.25)", [
      "#0a0f0a", "#ff5555", "#33ff66", "#ccff66", "#33cc99", "#99ff99", "#66ffcc", "#33ff66",
      "#1f7a3a", "#ff7777", "#66ff88", "#ddff88", "#55ddaa", "#bbffbb", "#88ffdd", "#ccffcc",
    ]),
  },
  {
    id: "dracula",
    name: "Dracula",
    dark: true,
    theme: t("#282a36", "#f8f8f2", "#f8f8f2", "#44475a", [
      "#21222c", "#ff5555", "#50fa7b", "#f1fa8c", "#bd93f9", "#ff79c6", "#8be9fd", "#f8f8f2",
      "#6272a4", "#ff6e6e", "#69ff94", "#ffffa5", "#d6acff", "#ff92df", "#a4ffff", "#ffffff",
    ]),
  },
  {
    id: "nord",
    name: "Nord",
    dark: true,
    theme: t("#2e3440", "#d8dee9", "#d8dee9", "#434c5e", [
      "#3b4252", "#bf616a", "#a3be8c", "#ebcb8b", "#81a1c1", "#b48ead", "#88c0d0", "#e5e9f0",
      "#4c566a", "#bf616a", "#a3be8c", "#ebcb8b", "#81a1c1", "#b48ead", "#8fbcbb", "#eceff4",
    ]),
  },
  {
    id: "one-dark",
    name: "One Dark",
    dark: true,
    theme: t("#282c34", "#abb2bf", "#528bff", "#3e4451", [
      "#3f4451", "#e06c75", "#98c379", "#e5c07b", "#61afef", "#c678dd", "#56b6c2", "#abb2bf",
      "#5c6370", "#e06c75", "#98c379", "#e5c07b", "#61afef", "#c678dd", "#56b6c2", "#ffffff",
    ]),
  },
  {
    id: "gruvbox",
    name: "Gruvbox",
    dark: true,
    theme: t("#282828", "#ebdbb2", "#ebdbb2", "#504945", [
      "#282828", "#cc241d", "#98971a", "#d79921", "#458588", "#b16286", "#689d6a", "#a89984",
      "#928374", "#fb4934", "#b8bb26", "#fabd2f", "#83a598", "#d3869b", "#8ec07c", "#ebdbb2",
    ]),
  },
  {
    id: "solarized-dark",
    name: "Solarized oscuro",
    dark: true,
    theme: t("#002b36", "#839496", "#93a1a1", "#073642", solarizedAnsi),
  },
  {
    id: "solarized-light",
    name: "Solarized claro",
    dark: false,
    theme: t("#fdf6e3", "#657b83", "#586e75", "#eee8d5", solarizedAnsi),
  },
];

/** "auto" sigue el modo de la interfaz. */
export function resolvePreset(id: string, appDark: boolean): TermPreset {
  if (id === "auto") return presets[appDark ? 0 : 1];
  return presets.find((p) => p.id === id) ?? presets[appDark ? 0 : 1];
}

/** Sigue el modo claro/oscuro del sistema operativo. */
export function useSystemDark(): boolean {
  const query = "(prefers-color-scheme: dark)";
  const [dark, setDark] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = (e: MediaQueryListEvent) => setDark(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return dark;
}

export const monoFont =
  'ui-monospace, "SF Mono", "Cascadia Mono", "JetBrains Mono", Menlo, Consolas, "DejaVu Sans Mono", "Liberation Mono", monospace';

export function fontStack(family: string): string {
  const f = family.trim().replace(/"/g, "");
  return f ? `"${f}", ${monoFont}` : monoFont;
}
