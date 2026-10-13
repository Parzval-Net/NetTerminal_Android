import { useEffect, useMemo, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { Channel, invoke } from "@tauri-apps/api/core";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import type { ITheme } from "@xterm/xterm";
import { ConnStatus, Session } from "../types";
import { fontStack } from "../lib/theme";
import { Settings } from "../lib/settings";
import { StreamHighlighter, compile, effectiveRules } from "../lib/highlight";
import { isMac, shortcutFor } from "../lib/platform";

export interface TermController {
  /** Id de la conexión vigente en el backend (cambia en cada reconexión). */
  connId: () => string;
  reconnect: () => void;
  openFind: () => void;
  focus: () => void;
  getSelection: () => string;
  isConnected: () => boolean;
  /** Envía texto como si se tecleara; con retardo > 0 lo hace línea a línea. */
  send: (text: string, lineDelayMs: number) => Promise<void>;
}

interface Props {
  id: string;
  session: Session;
  active: boolean;
  settings: Settings;
  theme: ITheme;
  onStatus: (id: string, status: ConnStatus) => void;
  onLog: (id: string, path: string | null) => void;
  register: (id: string, ctrl: TermController | null) => void;
}

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;

export function TerminalView({ id, session, active, settings, theme, onStatus, onLog, register }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const searchRef = useRef<SearchAddon | null>(null);
  const statusRef = useRef<ConnStatus>("connecting");
  const connIdRef = useRef("");
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const compiled = useMemo(
    () =>
      compile(
        effectiveRules(
          {
            enabled: settings.highlightEnabled,
            schemes: settings.highlightSchemes,
            custom: settings.customRules,
          },
          session.highlight,
        ),
      ),
    [settings.highlightEnabled, settings.highlightSchemes, settings.customRules, session.highlight],
  );
  const compiledRef = useRef(compiled);
  compiledRef.current = compiled;
  const [findOpen, setFindOpen] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    const term = new Terminal({
      fontFamily: fontStack(settings.fontFamily),
      fontSize: settings.fontSize,
      lineHeight: settings.lineHeight,
      cursorStyle: settings.cursorStyle,
      cursorBlink: settings.cursorBlink,
      scrollback: settings.scrollback,
      allowProposedApi: true,
      macOptionIsMeta: true,
      theme,
    });
    const fit = new FitAddon();
    const search = new SearchAddon();
    term.loadAddon(fit);
    term.loadAddon(search);
    term.loadAddon(new WebLinksAddon((_e, uri) => openUrl(uri)));
    term.open(hostRef.current!);
    try {
      const webgl = new WebglAddon();
      webgl.onContextLoss(() => webgl.dispose());
      term.loadAddon(webgl);
    } catch {
      // Sin WebGL se usa el renderizador DOM.
    }
    fit.fit();
    termRef.current = term;
    fitRef.current = fit;
    searchRef.current = search;

    // Resaltado: se decodifica UTF-8 en streaming y se colorea por líneas. En pantallas
    // completas (vim, top, less) no se toca nada.
    const hl = new StreamHighlighter(
      (text) => term.write(text),
      () => compiledRef.current,
      () => term.buffer.active.type === "alternate",
    );

    const setStatus = (s: ConnStatus) => {
      statusRef.current = s;
      onStatus(id, s);
    };

    let disposed = false;
    let attempt = 0;

    const connect = async () => {
      const connId = `${id}#${++attempt}`;
      connIdRef.current = connId;
      setStatus("connecting");
      const s = sessionRef.current;
      if (s.type !== "local") term.write(dim(`Conectando a ${s.name}…\r\n`));
      const decoder = new TextDecoder();
      const onData = new Channel<ArrayBuffer>();
      onData.onmessage = (buf) => {
        if (connIdRef.current === connId) hl.push(decoder.decode(new Uint8Array(buf), { stream: true }));
      };
      const onExit = new Channel<string>();
      onExit.onmessage = (reason) => {
        if (connIdRef.current !== connId) return;
        hl.flush();
        setStatus("closed");
        term.write(`\r\n${dim(`── ${reason}. Presiona Enter para reconectar ──`)}\r\n`);
      };
      try {
        await invoke("connect", {
          id: connId,
          session: s,
          cols: term.cols,
          rows: term.rows,
          onData,
          onExit,
        });
        if (disposed || connIdRef.current !== connId) {
          invoke("disconnect", { id: connId }).catch(() => {});
          return;
        }
        if (statusRef.current === "connecting") {
          setStatus("connected");
          if (settingsRef.current.autoLog) {
            invoke<string | null>("set_logging", {
              id: connId,
              enabled: true,
              timestamps: settingsRef.current.logTimestamps,
            })
              .then((path) => onLog(id, path))
              .catch(() => {});
          }
        }
      } catch (err) {
        if (disposed || connIdRef.current !== connId) return;
        setStatus("closed");
        term.write(`\r\n\x1b[31m${err}\x1b[0m\r\n${dim("── Presiona Enter para reintentar ──")}\r\n`);
      }
    };

    term.onData((data) => {
      if (statusRef.current === "closed") {
        if (data === "\r") {
          term.write("\r\n");
          connect();
        }
        return;
      }
      if (statusRef.current === "connected") invoke("write", { id: connIdRef.current, data }).catch(() => {});
    });

    term.onResize(({ cols, rows }) => {
      invoke("resize", { id: connIdRef.current, cols, rows }).catch(() => {});
    });

    // Copiar al seleccionar, como PuTTY/SecureCRT.
    term.onSelectionChange(() => {
      if (!settingsRef.current.copyOnSelect) return;
      const sel = term.getSelection();
      if (sel) writeText(sel).catch(() => {});
    });

    const paste = async () => {
      const text = await readText().catch(() => "");
      if (text) term.paste(text);
    };

    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== "keydown") return true;
      const key = e.key.toLowerCase();
      // Copiar/pegar explícito en Windows/Linux (en macOS lo resuelve el menú Edición nativo).
      if (!isMac && e.ctrlKey && e.shiftKey && key === "c") {
        const sel = term.getSelection();
        if (sel) writeText(sel).catch(() => {});
        return false;
      }
      if (!isMac && e.ctrlKey && e.shiftKey && key === "v") {
        paste();
        return false;
      }
      if (!isMac && e.shiftKey && key === "insert") {
        paste();
        return false;
      }
      // Los atajos de la app no llegan a la sesión remota.
      return shortcutFor(e) === null;
    });

    const onContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      if (settingsRef.current.rightClickPaste) paste();
    };
    hostRef.current!.addEventListener("contextmenu", onContextMenu);

    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (hostRef.current && hostRef.current.offsetWidth > 0) fit.fit();
      });
    });
    observer.observe(hostRef.current!);

    register(id, {
      connId: () => connIdRef.current,
      reconnect: () => {
        invoke("disconnect", { id: connIdRef.current }).catch(() => {});
        term.write("\r\n");
        connect();
      },
      openFind: () => setFindOpen(true),
      focus: () => term.focus(),
      getSelection: () => term.getSelection(),
      isConnected: () => statusRef.current === "connected",
      send: async (text, lineDelayMs) => {
        const data = text.replace(/\r?\n/g, "\r");
        if (lineDelayMs <= 0) {
          await invoke("write", { id: connIdRef.current, data });
          return;
        }
        const lines = data.split(/(?<=\r)/);
        for (const line of lines) {
          if (disposed || statusRef.current !== "connected") break;
          await invoke("write", { id: connIdRef.current, data: line });
          await new Promise((r) => setTimeout(r, lineDelayMs));
        }
      },
    });

    connect();
    const host = hostRef.current!;

    return () => {
      disposed = true;
      hl.dispose();
      register(id, null);
      observer.disconnect();
      cancelAnimationFrame(frame);
      host.removeEventListener("contextmenu", onContextMenu);
      invoke("disconnect", { id: connIdRef.current }).catch(() => {});
      term.dispose();
    };
    // El terminal vive mientras exista la pestaña; tema y fuente se actualizan aparte.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    const term = termRef.current;
    if (term) term.options.theme = theme;
  }, [theme]);

  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    term.options.fontFamily = fontStack(settings.fontFamily);
    term.options.fontSize = settings.fontSize;
    term.options.lineHeight = settings.lineHeight;
    term.options.cursorStyle = settings.cursorStyle;
    term.options.cursorBlink = settings.cursorBlink;
    term.options.scrollback = settings.scrollback;
    fitRef.current?.fit();
  }, [
    settings.fontFamily,
    settings.fontSize,
    settings.lineHeight,
    settings.cursorStyle,
    settings.cursorBlink,
    settings.scrollback,
  ]);

  useEffect(() => {
    if (active) {
      fitRef.current?.fit();
      termRef.current?.focus();
    }
  }, [active]);

  const findNext = (back = false) => {
    if (!query) return;
    const opts = {
      decorations: {
        matchOverviewRuler: "#e6c06b",
        activeMatchColorOverviewRuler: "#ef6b73",
        matchBackground: "#e6c06b55",
        activeMatchBackground: "#ef6b73aa",
      },
    };
    if (back) searchRef.current?.findPrevious(query, opts);
    else searchRef.current?.findNext(query, opts);
  };

  const closeFind = () => {
    setFindOpen(false);
    searchRef.current?.clearDecorations();
    termRef.current?.focus();
  };

  return (
    <div
      className="absolute inset-0"
      style={{ visibility: active ? "visible" : "hidden", background: theme.background }}
    >
      <div ref={hostRef} className="w-full h-full" />
      {findOpen && (
        <div className="absolute top-2 right-4 flex items-center gap-1 bg-panel border border-line rounded-lg shadow-pop px-2 py-1.5 z-10">
          <input
            autoFocus
            className="field !h-7 !w-56"
            placeholder="Buscar en la salida"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") findNext(e.shiftKey);
              if (e.key === "Escape") closeFind();
            }}
          />
          <IconBtn title="Anterior (Shift+Enter)" onClick={() => findNext(true)}>
            <ChevronUp size={15} />
          </IconBtn>
          <IconBtn title="Siguiente (Enter)" onClick={() => findNext()}>
            <ChevronDown size={15} />
          </IconBtn>
          <IconBtn title="Cerrar (Esc)" onClick={closeFind}>
            <X size={15} />
          </IconBtn>
        </div>
      )}
    </div>
  );
}

function IconBtn(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className="w-7 h-7 grid place-items-center rounded-md text-muted hover:text-fg hover:bg-hover"
    />
  );
}
