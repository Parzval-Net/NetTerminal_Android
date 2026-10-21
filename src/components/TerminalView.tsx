import { memo, useEffect, useMemo, useRef, useState } from "react";
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
  /** Escribe texto en la sesión sin Enter (para completar antes de ejecutar). */
  type: (text: string) => void;
  /** Cierra la conexión dejando la pestaña abierta. */
  disconnect: () => void;
  clearScrollback: () => void;
  reset: () => void;
  /** Copia todo el historial al portapapeles; devuelve las líneas copiadas. */
  copyAll: () => Promise<number>;
}

const NEWLINE = { cr: "\r", lf: "\n", crlf: "\r\n" } as const;
const MAX_RECONNECTS = 30;
/** Espera creciente (5, 10, 20, 40, 60 s…) para no gatillar bloqueos de cuenta en TACACS/RADIUS. */
const reconnectSecs = (attempt: number) => Math.min(60, 5 * 2 ** Math.max(0, attempt - 1));

interface Props {
  id: string;
  session: Session;
  active: boolean;
  settings: Settings;
  theme: ITheme;
  onStatus: (id: string, status: ConnStatus) => void;
  onLog: (id: string, path: string | null) => void;
  /** Log activo de la pestaña: al reconectar se sigue escribiendo en el mismo archivo. */
  logPath: string | null;
  /** Llegó salida mientras la pestaña no estaba visible. */
  onActivity: (id: string) => void;
  register: (id: string, ctrl: TermController | null) => void;
}

/** Manejador vacío a nivel de módulo: uno creado dentro de la terminal retendría su contexto. */
const NOOP = () => {};

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;

export const TerminalView = memo(function TerminalView({ id, session, active, settings, theme, onStatus, onLog, logPath, onActivity, register }: Props) {
  const activeRef = useRef(active);
  activeRef.current = active;
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
  const logPathRef = useRef(logPath);
  logPathRef.current = logPath;
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
  /** Bloque multilínea pegado que espera confirmación antes de llegar al equipo. */
  const [pasteAsk, setPasteAsk] = useState<string | null>(null);
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
    // Reconexión automática: se cancela con Esc o al desconectar a mano.
    let manualClose = false;
    let retries = 0;
    let retryTimer: number | undefined;
    let channels: Channel<unknown>[] = [];
    const releaseChannels = () => {
      for (const ch of channels) ch.onmessage = NOOP;
      channels = [];
    };
    let lastDataAt = 0;
    /** Final de la salida reciente (sin ANSI), para reconocer el prompt. */
    let tail = "";

    const newline = () => NEWLINE[sessionRef.current.newline ?? "cr"];

    const cancelRetry = () => {
      window.clearTimeout(retryTimer);
      retryTimer = undefined;
    };

    /** Envía los "comandos al conectar" cuando el equipo deja de escribir (prompt listo). */
    // Prompt típico de equipos y shells; nunca se envía sobre un pedido de credenciales.
    const PROMPT = /[>#$%\]]\s*$/;
    const CREDENTIALS = /(password|passphrase|contraseña|username|user name|login)[^\n]*:\s*$/i;
    const cleanTail = () => tail.replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]/g, "").replace(/\r/g, "");
    /** Espera a que el equipo muestre su prompt (o quede en silencio sin pedir credenciales). */
    const waitReady = async (connId: string, since: number, maxMs: number) => {
      const start = Date.now();
      while (Date.now() - start < maxMs) {
        await new Promise((r) => setTimeout(r, 150));
        if (disposed || connIdRef.current !== connId || statusRef.current !== "connected") return false;
        if (lastDataAt <= since) continue;
        const quiet = Date.now() - lastDataAt;
        const t = cleanTail();
        if (CREDENTIALS.test(t)) continue;
        if ((PROMPT.test(t) && quiet > 200) || quiet > 1500) return true;
      }
      return false;
    };

    const runOnConnect = async (connId: string) => {
      const lines = (sessionRef.current.on_connect ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
      if (!lines.length) return;
      // Hasta 2 minutos: da tiempo a escribir la contraseña antes del primer comando.
      if (!(await waitReady(connId, 0, 120_000))) return;
      for (const line of lines) {
        if (disposed || connIdRef.current !== connId || statusRef.current !== "connected") return;
        const sent = Date.now();
        await invoke("write", { id: connId, data: line + newline() }).catch(() => {});
        await waitReady(connId, sent, 5000);
      }
    };

    const connect = async () => {
      cancelRetry();
      manualClose = false;
      tail = "";
      lastDataAt = 0;
      const connId = `${id}#${++attempt}`;
      connIdRef.current = connId;
      setStatus("connecting");
      const s = sessionRef.current;
      if (s.type !== "local") term.write(dim(`Conectando a ${s.name}…\r\n`));
      let decoder: TextDecoder;
      try {
        decoder = new TextDecoder(s.encoding || "utf-8");
      } catch {
        decoder = new TextDecoder();
      }
      // Los canales de la conexión anterior dejan de retener la terminal (y su historial)
      // aunque el aviso de cierre del backend no llegue.
      releaseChannels();
      const onData = new Channel<ArrayBuffer>();
      onData.onmessage = (buf) => {
        if (connIdRef.current !== connId) return;
        lastDataAt = Date.now();
        const text = decoder.decode(new Uint8Array(buf), { stream: true });
        tail = (tail + text).slice(-400);
        hl.push(text);
        if (!activeRef.current) onActivity(id);
      };
      const onExit = new Channel<string>();
      channels = [onData as Channel<unknown>, onExit as Channel<unknown>];
      onExit.onmessage = (reason) => {
        if (connIdRef.current !== connId) return;
        hl.flush();
        setStatus("closed");
        if (sessionRef.current.scp) {
          // Transferencia SCP: no se repite con Enter para no sobrescribir por accidente.
          term.write(`\r\n${dim(`── ${reason}. Transferencia terminada: puedes cerrar esta pestaña ──`)}\r\n`);
        } else if (!manualClose && sessionRef.current.auto_reconnect && retries < MAX_RECONNECTS) {
          retries++;
          const wait = reconnectSecs(retries);
          term.write(
            `\r\n${dim(`── ${reason}. Reconectando en ${wait} s (intento ${retries}/${MAX_RECONNECTS}) · Enter: ahora · Esc: cancelar ──`)}\r\n`,
          );
          retryTimer = window.setTimeout(connect, wait * 1000);
        } else {
          term.write(`\r\n${dim(`── ${reason}. Presiona Enter para reconectar ──`)}\r\n`);
        }
        if (!activeRef.current) onActivity(id);
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
          retries = 0;
          runOnConnect(connId);
          // Un log activado a mano (o el automático) continúa en su archivo tras reconectar.
          const resume = logPathRef.current;
          if (resume || settingsRef.current.autoLog) {
            invoke<string | null>("set_logging", {
              id: connId,
              enabled: true,
              timestamps: settingsRef.current.logTimestamps,
              resume,
            })
              .then((path) => onLog(id, path))
              .catch(() => {});
          }
        }
      } catch (err) {
        if (disposed || connIdRef.current !== connId) return;
        setStatus("closed");
        if (sessionRef.current.auto_reconnect && !manualClose && retries < MAX_RECONNECTS) {
          retries++;
          const wait = reconnectSecs(retries);
          term.write(
            `\r\n\x1b[31m${err}\x1b[0m\r\n${dim(`── Reintentando en ${wait} s (intento ${retries}/${MAX_RECONNECTS}) · Esc: cancelar ──`)}\r\n`,
          );
          retryTimer = window.setTimeout(connect, wait * 1000);
        } else {
          term.write(`\r\n\x1b[31m${err}\x1b[0m\r\n${dim("── Presiona Enter para reintentar ──")}\r\n`);
        }
      }
    };

    const disconnect = () => {
      manualClose = true;
      cancelRetry();
      if (statusRef.current === "closed") return;
      invoke("disconnect", { id: connIdRef.current }).catch(() => {});
      hl.flush();
      setStatus("closed");
      term.write(`\r\n${dim("── Desconectado. Presiona Enter para reconectar ──")}\r\n`);
    };

    term.onData((data) => {
      if (statusRef.current === "closed") {
        if (sessionRef.current.scp) return;
        if (data === "\r") {
          term.write("\r\n");
          retries = 0;
          connect();
        } else if (data === "\x1b" && retryTimer !== undefined) {
          cancelRetry();
          manualClose = true;
          term.write(`${dim("── Reconexión cancelada. Enter para reconectar ──")}\r\n`);
        }
        return;
      }
      if (statusRef.current !== "connected") return;
      const s = sessionRef.current;
      if (s.local_echo) term.write(data.replace(/\r/g, "\r\n").replace(/\x7f/g, "\b \b"));
      const out = s.newline && s.newline !== "cr" ? data.replace(/\r/g, newline()) : data;
      invoke("write", { id: connIdRef.current, data: out }).catch(() => {});
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

    // Pegar varias líneas en un equipo remoto equivale a aplicar configuración: se confirma.
    const needsConfirm = (text: string) =>
      settingsRef.current.confirmSend && sessionRef.current.type !== "local" && /\r?\n\s*\S/.test(text.trimEnd());
    const paste = async () => {
      const text = await readText().catch(() => "");
      if (!text) return;
      if (needsConfirm(text)) setPasteAsk(text);
      else term.paste(text);
    };
    // Cmd+V en macOS llega por el menú nativo como evento "paste", sin pasar por paste().
    const onNativePaste = (e: ClipboardEvent) => {
      const text = e.clipboardData?.getData("text/plain") ?? "";
      if (!needsConfirm(text)) return;
      e.preventDefault();
      e.stopPropagation();
      setPasteAsk(text);
    };
    hostRef.current!.addEventListener("paste", onNativePaste, true);

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
        const data = text.replace(/\r?\n/g, newline());
        if (lineDelayMs <= 0) {
          await invoke("write", { id: connIdRef.current, data });
          return;
        }
        const lines = data.split(/(?<=\r\n|\r(?!\n)|(?<!\r)\n)/);
        for (const line of lines) {
          if (disposed || statusRef.current !== "connected") break;
          await invoke("write", { id: connIdRef.current, data: line });
          await new Promise((r) => setTimeout(r, lineDelayMs));
        }
      },
      type: (text) => {
        if (statusRef.current === "connected") invoke("write", { id: connIdRef.current, data: text }).catch(() => {});
        term.focus();
      },
      disconnect,
      clearScrollback: () => term.clear(),
      reset: () => term.reset(),
      copyAll: async () => {
        const buf = term.buffer.active;
        const lines: string[] = [];
        for (let i = 0; i < buf.length; i++) lines.push(buf.getLine(i)?.translateToString(true) ?? "");
        while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
        await writeText(lines.join("\n"));
        return lines.length;
      },
    });

    connect();
    const host = hostRef.current!;

    return () => {
      disposed = true;
      releaseChannels();
      cancelRetry();
      hl.dispose();
      register(id, null);
      observer.disconnect();
      cancelAnimationFrame(frame);
      host.removeEventListener("contextmenu", onContextMenu);
      host.removeEventListener("paste", onNativePaste, true);
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

  // WebGL solo en la pestaña visible: Chromium limita los contextos WebGL activos y, con
  // muchas pestañas, perdía los más antiguos sin control. Al ocultarse se libera tras un
  // rato (cambiar de pestaña y volver no lo recrea) y se usa el renderizador DOM.
  const webglRef = useRef<WebglAddon | null>(null);
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    if (active) {
      if (!webglRef.current) {
        try {
          const webgl = new WebglAddon();
          webgl.onContextLoss(() => {
            webgl.dispose();
            if (webglRef.current === webgl) webglRef.current = null;
          });
          term.loadAddon(webgl);
          webglRef.current = webgl;
        } catch {
          // Sin WebGL se usa el renderizador DOM.
        }
      }
      fitRef.current?.fit();
      term.focus();
      return;
    }
    const release = window.setTimeout(() => {
      webglRef.current?.dispose();
      webglRef.current = null;
    }, 30_000);
    return () => window.clearTimeout(release);
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
      {pasteAsk !== null && (
        <PasteConfirm
          text={pasteAsk}
          target={session.name}
          onDone={(ok) => {
            if (ok) termRef.current?.paste(pasteAsk);
            setPasteAsk(null);
            termRef.current?.focus();
          }}
        />
      )}
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
});

function IconBtn(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      aria-label={props.title}
      {...props}
      className="w-7 h-7 grid place-items-center rounded-md text-muted hover:text-fg hover:bg-hover"
    />
  );
}

function PasteConfirm({ text, target, onDone }: { text: string; target: string; onDone: (ok: boolean) => void }) {
  const lines = text.replace(/\r\n/g, "\n").trimEnd().split("\n");
  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="paste-title"
      className="absolute left-1/2 bottom-6 -translate-x-1/2 w-[min(560px,92%)] bg-panel border border-line rounded-xl shadow-pop p-4 z-20"
      onKeyDown={(e) => {
        if (e.key === "Escape") onDone(false);
      }}
    >
      <h3 id="paste-title" className="text-[13px] font-semibold mb-1">
        ¿Pegar {lines.length} líneas en {target}?
      </h3>
      <p className="text-[11.5px] text-muted mb-2">Cada línea se ejecuta en el equipo como si la escribieras.</p>
      <pre className="max-h-40 overflow-auto rounded-md bg-hover p-2 font-mono text-[11.5px] whitespace-pre">
        {lines.slice(0, 12).join("\n")}
        {lines.length > 12 ? `\n… y ${lines.length - 12} líneas más` : ""}
      </pre>
      <div className="flex justify-end gap-2 mt-3">
        <button onClick={() => onDone(false)} className="px-3.5 h-8 rounded-md border border-line hover:bg-hover">
          Cancelar
        </button>
        <button autoFocus onClick={() => onDone(true)} className="px-3.5 h-8 rounded-md bg-accent text-accent-fg font-medium hover:opacity-90">
          Pegar
        </button>
      </div>
    </div>
  );
}
