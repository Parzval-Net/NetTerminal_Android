import { type ReactNode, Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { moveItem } from "./lib/tabDrag";
import { invoke } from "@tauri-apps/api/core";
import { Sidebar } from "./components/Sidebar";
import { TabBar, type TabBarProps } from "./components/TabBar";
import { VerticalTabs } from "./components/VerticalTabs";
import { StatusBar } from "./components/StatusBar";
import { TerminalView, TermController } from "./components/TerminalView";
import { CredChange, SessionModal } from "./components/SessionModal";
import { CommandPalette } from "./components/CommandPalette";
import { QuickConnectDialog } from "./components/QuickConnectDialog";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { CloseManyMessage } from "./components/CloseManyMessage";
import { CloseScope, summarizeClose, tabsToClose } from "./lib/closeAll";
import { NotesPanel } from "./components/NotesPanel";
import { CommandsPanel } from "./components/CommandsPanel";
import { vendorFor } from "./lib/commands";
import { CatalogEntry, Pack, PackCommand, Risk, buildCatalog, computeRisk, detectPlatform, riskLabel, validatePack } from "./lib/packs";
import type { ScpRequest } from "./components/tools/FileManager";
import { runOnDevice } from "./lib/deviceRun";
import { PacksModal } from "./components/PacksModal";
import { CommandEditor } from "./components/CommandEditor";
import { TemplateDialog, templateVars } from "./components/TemplateDialog";
import { compile, effectiveRules } from "./lib/highlight";
import { allFolders } from "./lib/folders";
import { useMonitors } from "./lib/monitors";
import { ButtonBar } from "./components/ButtonBar";
import { MacroModal } from "./components/MacroModal";
import { ApprovalDialog, ApprovalRequest } from "./components/ApprovalDialog";
import { ScriptPrompts } from "./components/ScriptPrompts";
import { ScriptLaunch, ScriptLaunchDialog } from "./components/ScriptLaunchDialog";
import type { Section } from "./components/SettingsModal";
import type { Macro, UpdateInfo } from "./lib/settings";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Sparkles, X as XIcon } from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import { ConnStatus, Session, Tab, TabState, historyKey, tabTitle } from "./types";
import { closeAllLabel, localOsVendor, modLabel, shortcutFor } from "./lib/platform";
import { resolvePreset, useSystemDark } from "./lib/theme";
import { Settings, logOptions, useSettings } from "./lib/settings";
import { useAlerts } from "./lib/alerts";
import { BroadcastBar, BroadcastDialog } from "./components/BroadcastDialog";
import { Resolved, getBroadcastRun, isBroadcastRunning, publishWorkspace, stopBroadcast, resolveTargets, runBroadcast, targetLabel, useBroadcastTarget, useWorkspace } from "./lib/broadcast";
import { SplitPanes } from "./components/SplitPanes";
import { SplitLayout, SplitState, fillPanes, paneRect } from "./lib/split";
import logo from "./assets/logo.svg";
import { plural } from "./lib/plural";
import { isQuickSession } from "./components/SessionIcon";
import "./App.css";

// Vistas pesadas y de uso ocasional: se cargan aparte para aligerar el arranque.
const ToolsView = lazy(() => import("./components/tools/ToolsView").then((m) => ({ default: m.ToolsView })));
const SettingsModal = lazy(() => import("./components/SettingsModal").then((m) => ({ default: m.SettingsModal })));
const ImportDialog = lazy(() => import("./components/ImportDialog").then((m) => ({ default: m.ImportDialog })));

const LOCAL: Session = { id: "local", name: "Terminal local", type: "local", created_at: "" };

/**
 * Manejadores con identidad estable que siempre llaman a la versión más reciente: los
 * paneles memorizados no se vuelven a dibujar cada vez que App lo hace.
 */
function useHandlers<T extends Record<string, (...args: never[]) => unknown>>(handlers: T): T {
  const ref = useRef(handlers);
  ref.current = handlers;
  return useMemo(() => {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(ref.current)) out[k] = (...args: never[]) => ref.current[k](...args);
    return out as T;
  }, []);
}

function stored<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : (JSON.parse(v) as T);
  } catch {
    return fallback;
  }
}

function persist(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* sin almacenamiento local: se usa el valor por defecto */
  }
}

let tabSeq = 0;

export default function App() {
  const [settings, update] = useSettings();
  // Espera los ajustes para no mostrar un tema y luego cambiarlo.
  if (!settings) return null;
  return <Workspace settings={settings} update={update} />;
}

function Workspace({
  settings,
  update,
}: {
  settings: Settings;
  update: (p: Partial<Settings> | ((s: Settings) => Partial<Settings>)) => void;
}) {
  const systemDark = useSystemDark();
  const dark = settings.appTheme === "system" ? systemDark : settings.appTheme === "dark";
  const preset = resolvePreset(settings.terminalTheme, dark);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<Section | undefined>();
  const [macroEdit, setMacroEdit] = useState<Macro | null | undefined>(undefined);
  const [scriptRun, setScriptRun] = useState<{ run: string; script: string; targets: number } | null>(null);
  const scriptRunRef = useRef(scriptRun);
  scriptRunRef.current = scriptRun;
  const [scriptLaunch, setScriptLaunch] = useState<string | null>(null);
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
  const [mcpStatus, setMcpStatus] = useState("");
  const [toasts, setToasts] = useState<{ id: number; text: string; kind: "info" | "error" | "ai" }[]>([]);
  const toastSeq = useRef(0);
  const toast = useCallback((text: string, kind: "info" | "error" | "ai" = "info") => {
    const id = ++toastSeq.current;
    setToasts((t) => [...t.slice(-3), { id, text, kind }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === "error" ? 7000 : 4000);
  }, []);
  const [confirm, setConfirm] = useState<{
    title: string;
    message: ReactNode;
    label: string;
    danger?: boolean;
    defaultCancel?: boolean;
    action: () => void;
  } | null>(null);
  const [template, setTemplate] = useState<{ text: string; then: (filled: string) => void } | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [states, setStates] = useState<Record<string, TabState>>({});
  const [activeId, setActiveId] = useState<string | null>(null);
  /** `tabId`: la pestaña de conexión rápida que pasa a usar la sesión guardada. */
  const [modal, setModal] = useState<{ session?: Session; folder?: string; tabId?: string } | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(() => stored("sidebar", true));
  const controllers = useRef(new Map<string, TermController>());

  useEffect(() => persist("sidebar", sidebarOpen), [sidebarOpen]);
  const [notesOpen, setNotesOpenRaw] = useState(() => stored("notesOpen", false));
  const [commandsOpen, setCommandsOpenRaw] = useState(() => stored("commandsOpen", false));
  useEffect(() => persist("commandsOpen", commandsOpen), [commandsOpen]);
  // Notas y Comandos comparten el lado derecho: abrir uno cierra el otro.
  const setNotesOpen = (v: boolean | ((o: boolean) => boolean)) =>
    setNotesOpenRaw((o) => {
      const next = typeof v === "function" ? v(o) : v;
      if (next) setCommandsOpenRaw(false);
      return next;
    });
  const setCommandsOpen = (v: boolean | ((o: boolean) => boolean)) =>
    setCommandsOpenRaw((o) => {
      const next = typeof v === "function" ? v(o) : v;
      if (next) setNotesOpenRaw(false);
      return next;
    });
  const [notesWidth, setNotesWidth] = useState(() => stored("notesWidth", 380));
  useEffect(() => persist("notesOpen", notesOpen), [notesOpen]);
  useEffect(() => persist("notesWidth", notesWidth), [notesWidth]);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = dark ? "dark" : "light";
    root.style.setProperty("--term-bg", String(preset.theme.background));
    root.style.setProperty("--term-fg", String(preset.theme.foreground));
  }, [dark, preset]);

  // Servidor MCP: se (re)configura cuando cambian sus ajustes.
  useEffect(() => {
    invoke<string>("mcp_configure", {
      enabled: settings.mcpEnabled,
      port: settings.mcpPort,
      token: settings.mcpToken,
      requireApproval: settings.mcpApproval,
      readOnly: settings.mcpReadOnly,
    })
      .then(setMcpStatus)
      .catch((e) => {
        setMcpStatus(String(e));
        if (settings.mcpEnabled) toast(`MCP: ${e}`, "error");
      });
  }, [settings.mcpEnabled, settings.mcpPort, settings.mcpToken, settings.mcpApproval, settings.mcpReadOnly, toast]);

  useEffect(() => {
    const un = listen("open-settings", () => setSettingsOpen(true));
    return () => {
      un.then((f) => f());
    };
  }, []);

  // Carpeta de logs elegida por el usuario: el backend la valida y la usa para los logs nuevos.
  // Si no está disponible (pendrive o unidad de red sin montar al abrir) se usa la
  // predeterminada solo en esta ejecución: el ajuste se conserva para la próxima vez.
  useEffect(() => {
    invoke("logs_dir_set", { path: settings.logsDir || null }).catch((e) =>
      toast(`Carpeta de logs: ${e}. En esta ejecución se usa la predeterminada.`, "error"),
    );
  }, [settings.logsDir, toast]);

  useEffect(() => {
    invoke<Session[]>("list_sessions").then(setSessions).catch(console.error);
  }, []);

  const openTab = useCallback((session: Session) => {
    const id = `t${++tabSeq}`;
    setTabs((t) => [...t, { id, session }]);
    setStates((s) => ({ ...s, [id]: { status: "connecting", logPath: null } }));
    setActiveId(id);
  }, []);

  // Aviso único por ejecución: con muchas pestañas el historial de pantalla domina la memoria
  // (medido: unos 3 MB por cada 1.000 líneas llenas por pestaña).
  const memoryHinted = useRef(false);
  useEffect(() => {
    if (memoryHinted.current || tabs.length <= 15) return;
    memoryHinted.current = true;
    const mb = Math.round((tabs.length * settings.scrollback * 3) / 1000);
    toast(
      `Tienes ${tabs.length} sesiones abiertas: con el historial lleno pueden ocupar hasta ~${mb} MB. ` +
        "Si el equipo anda lento, cierra las que no uses o baja el historial en Ajustes › Terminal.",
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabs.length]);

  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;

  useEffect(() => {
    const subs = [
      listen<ApprovalRequest>("mcp-approval", (e) => setApprovals((a) => [...a, e.payload])),
      listen<string>("mcp-approval-closed", (e) => setApprovals((a) => a.filter((x) => x.id !== e.payload))),
      listen<string>("mcp-open-session", (e) => {
        const s = sessionsRef.current.find((x) => x.id === e.payload);
        if (s) openTab(s);
      }),
      listen<{ tool: string; target: string; detail: string; ok: boolean }>("mcp-activity", (e) => {
        const { tool, target, detail, ok } = e.payload;
        if (tool === "send_command" || tool === "open_session")
          toast(`IA · ${ok ? "" : "rechazado: "}${detail.split("\n")[0]}${target ? ` → ${target}` : ""}`, "ai");
      }),
      listen<{ run: string; script: string; kind: string; message: string }>("script-event", (e) => {
        const { kind, message, script, run } = e.payload;
        if (kind === "log") toast(`${script}: ${message}`);
        else {
          // Los plugins usan el mismo evento: solo el fin del script lanzado libera el botón.
          if (scriptRunRef.current?.run === run) setScriptRun(null);
          toast(`${script}: ${message}`, kind === "error" ? "error" : "info");
        }
      }),
    ];
    return () => subs.forEach((u) => u.then((f) => f()));
  }, [openTab, toast]);


  const [toolsOpen, setToolsOpen] = useState(false);

  // Pestañas en segundo plano con salida nueva (se limpia al verlas).
  const [activity, setActivity] = useState<Set<string>>(new Set());
  const markActivity = useCallback((id: string) => {
    setActivity((a) => (a.has(id) ? a : new Set(a).add(id)));
  }, []);
  useEffect(() => {
    if (activeId) setActivity((a) => (a.has(activeId) ? new Set([...a].filter((x) => x !== activeId)) : a));
  }, [activeId]);

  // Alertas por palabra clave: aviso, sonido y marca en la pestaña (se limpia al verla).
  const [alerted, setAlerted] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (activeId) setAlerted((a) => (a.has(activeId) ? new Set([...a].filter((x) => x !== activeId)) : a));
  }, [activeId]);
  useAlerts(
    settings.alertRules,
    (hit, rule) => {
      const tab = tabs.find((t) => t.id === hit.conn.split("#")[0]);
      if (!tab) return;
      if (rule.toast) toast(`${tabTitle(tab)} · ${rule.name || rule.pattern}: ${hit.line}`, "error");
      if (rule.markTab && tab.id !== activeId) setAlerted((a) => (a.has(tab.id) ? a : new Set(a).add(tab.id)));
    },
    (msg) => toast(msg, "error"),
  );

  // Actualizaciones: el latest.json firmado del repositorio de la app, al abrir y cada 6 h.
  // Lo que se anuncia es lo que se instala, y siempre con confirmación.
  const [update_, setUpdate] = useState<UpdateInfo | null>(null);
  const [showNotes, setShowNotes] = useState(false);
  const [installing, setInstalling] = useState<number | null>(null);
  const dismissedRef = useRef(settings.updateDismissed);
  dismissedRef.current = settings.updateDismissed;
  useEffect(() => {
    const check = () =>
      invoke<UpdateInfo>("update_check")
        .then((u) => {
          if (u.newer && u.latest !== dismissedRef.current) setUpdate(u);
        })
        .catch(() => {});
    // Unos segundos después de abrir, para no competir con el arranque.
    const first = window.setTimeout(check, 4000);
    const every = window.setInterval(check, 6 * 3600 * 1000);
    // "Buscar ahora" en Ajustes muestra el aviso al instante.
    const onFound = (e: Event) => setUpdate((e as CustomEvent<UpdateInfo>).detail);
    window.addEventListener("nt-update-found", onFound);
    const un = listen<{ downloaded: number; total: number | null }>("update-progress", ({ payload }) =>
      setInstalling(payload.total ? Math.round((payload.downloaded / payload.total) * 100) : 0),
    );
    return () => {
      window.clearTimeout(first);
      window.clearInterval(every);
      window.removeEventListener("nt-update-found", onFound);
      un.then((f) => f());
    };
  }, []);
  const installUpdate = () => {
    const run = () => {
      setInstalling(0);
      invoke("update_install").catch((e) => {
        setInstalling(null);
        toast(String(e), "error");
      });
    };
    const open = Object.values(states).filter((x) => x.status === "connected").length;
    if (open)
      setConfirm({
        title: "¿Actualizar y reiniciar?",
        message: `Se cerrarán ${open} ${open === 1 ? "sesión abierta" : "sesiones abiertas"}. Las sesiones guardadas, notas y ajustes se conservan.`,
        label: "Actualizar y reiniciar",
        action: run,
      });
    else run();
  };
  const lastTermRef = useRef<string | null>(null);
  useEffect(() => {
    if (activeId && activeId !== "tools") lastTermRef.current = activeId;
  }, [activeId]);

  const monitors = useMonitors(settings.monitors, toast);

  const openTools = useCallback(() => {
    setToolsOpen(true);
    setActiveId("tools");
  }, []);

  const closeTab = useCallback((id: string) => {
    if (id === "tools") {
      setToolsOpen(false);
      setActiveId((cur) => (cur === "tools" ? lastTermRef.current : cur));
      return;
    }
    setTabs((prev) => {
      const idx = prev.findIndex((t) => t.id === id);
      const next = prev.filter((t) => t.id !== id);
      setActiveId((cur) => {
        if (cur !== id) return cur;
        const fallback = next[Math.min(idx, next.length - 1)]?.id ?? null;
        if (lastTermRef.current === id) lastTermRef.current = fallback;
        return fallback;
      });
      return next;
    });
    setStates(({ [id]: _, ...rest }) => rest);
  }, []);

  // Evita cortar por accidente una sesión remota activa.
  const requestClose = (id: string) => {
    const tab = tabs.find((t) => t.id === id);
    const risky = tab && tab.session.type !== "local" && states[id]?.status === "connected";
    // Una conexión rápida sin guardar se pierde al cerrar: se avisa siempre, aunque "Confirmar al cerrar" esté apagado.
    const quick = !!tab && isQuickSession(tab.session);
    if (tab && ((settings.confirmClose && risky) || quick))
      setConfirm({
        title: risky ? "¿Cerrar la sesión?" : "¿Cerrar la conexión rápida?",
        message: [
          risky && `Se cortará la conexión con ${tabTitle(tab)}.`,
          quick && "Es una conexión rápida sin guardar: sus datos se pierden. Para conservarla, usa «Guardar como sesión…» en el menú de la pestaña.",
        ]
          .filter(Boolean)
          .join("\n\n"),
        label: risky ? "Cerrar sesión" : "Cerrar",
        danger: true,
        action: () => closeTab(id),
      });
    else closeTab(id);
  };

  const onLog = useCallback((id: string, path: string | null) => {
    setStates((s) => (s[id] ? { ...s, [id]: { ...s[id], logPath: path } } : s));
  }, []);

  const onStatus = useCallback((id: string, status: ConnStatus) => {
    setStates((s) =>
      s[id]
        ? { ...s, [id]: { ...s[id], status } }
        : s,
    );
  }, []);

  const register = useCallback((id: string, ctrl: TermController | null) => {
    if (ctrl) controllers.current.set(id, ctrl);
    else controllers.current.delete(id);
  }, []);

  const newLocal = useCallback(
    () => openTab(sessions.find((s) => s.type === "local") ?? LOCAL),
    [sessions, openTab],
  );

  const activeTab = tabs.find((t) => t.id === activeId);
  const activeCtrl = () => (activeId ? controllers.current.get(activeId) : undefined);
  const activeConnected = !!activeTab && states[activeTab.id]?.status === "connected";

  // ---------- Vista dividida ----------
  const [split, setSplit] = useState<SplitState | null>(null);
  /** Panel que recibe la pestaña elegida en la barra cuando no está en ningún panel. */
  const focusPaneRef = useRef(0);
  const splitOn = !!split && activeId !== "tools";
  const tabIdsKey = tabs.map((t) => t.id).join(",");
  // Pestañas cerradas dejan su panel vacío.
  useEffect(() => {
    setSplit((s) =>
      s && s.panes.some((id) => id && !tabs.some((t) => t.id === id))
        ? { ...s, panes: s.panes.map((id) => (id && tabs.some((t) => t.id === id) ? id : null)) }
        : s,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabIdsKey]);
  // Elegir en la barra una pestaña que no está a la vista la pone en el panel con foco.
  useEffect(() => {
    if (!split || !activeId || activeId === "tools") return;
    const i = split.panes.indexOf(activeId);
    if (i >= 0) focusPaneRef.current = i;
    else setSplit({ ...split, panes: split.panes.map((id, k) => (k === focusPaneRef.current ? activeId : id)) });
  }, [activeId, split]);
  const changeSplit = (layout: SplitLayout | null) => {
    if (!layout) return setSplit(null);
    const ids = tabs.map((t) => t.id);
    setSplit((s) => ({ layout, panes: fillPanes(layout, s?.panes ?? [], ids, activeId !== "tools" ? activeId : null) }));
    if (activeId === "tools") setActiveId(lastTermRef.current);
  };
  const pickPane = (pane: number, tabId: string | null) => {
    setSplit((s) => {
      if (!s) return s;
      const panes = [...s.panes];
      const other = tabId ? panes.indexOf(tabId) : -1;
      if (other >= 0) panes[other] = panes[pane];
      panes[pane] = tabId;
      return { ...s, panes };
    });
    focusPaneRef.current = pane;
    if (tabId) setActiveId(tabId);
  };
  const visibleKey = splitOn ? split!.panes.filter(Boolean).join(",") : null;
  const visiblePanes = useMemo(() => (visibleKey === null ? null : visibleKey.split(",").filter(Boolean)), [visibleKey]);

  // ---------- Cerrar varias pestañas ----------
  /**
   * Cierra en tandas de 6 por cuadro: cada pestaña se libera igual que con closeTab (al
   * desmontarse TerminalView corta la conexión, cierra el log y libera xterm), sin congelar
   * la interfaz con decenas de terminales a la vez. Herramientas no se toca.
   */
  const closeMany = (scope: CloseScope, ids: string[], refId?: string) => {
    if (!ids.length) return;
    const gone = new Set(ids);
    // La pestaña de referencia (o Herramientas, o ninguna) queda activa antes de empezar,
    // así closeTab no salta de una pestaña que se va a cerrar a otra.
    const keep = scope === "all" ? (toolsOpen ? "tools" : null) : (refId ?? null);
    setActiveId((cur) => (cur && !gone.has(cur) ? cur : keep));
    if (lastTermRef.current && gone.has(lastTermRef.current)) lastTermRef.current = scope === "all" ? null : (refId ?? null);
    if (scope === "all") {
      setSplit(null);
      if (isBroadcastRunning()) stopBroadcast();
    }
    const queue = [...ids];
    const step = () => {
      queue.splice(0, 6).forEach(closeTab);
      if (queue.length) window.setTimeout(step, 16);
    };
    step();
  };

  /** Avisa qué se corta antes de cerrar varias pestañas; sin nada conectado, sin conexiones rápidas y sin "Confirmar al cerrar", cierra directo. */
  const requestCloseMany = (scope: CloseScope, refId?: string) => {
    const list = tabsToClose(tabs, scope, refId);
    if (!list.length) return;
    const ids = list.map((t) => t.id);
    const summary = summarizeClose(list, states);
    const run = () => closeMany(scope, ids, refId);
    // Las conexiones rápidas sin guardar se avisan siempre: cerrarlas pierde su configuración.
    if (!settings.confirmClose && summary.connected.length === 0 && summary.transfers === 0 && summary.quick === 0) return run();
    const bc = getBroadcastRun();
    const broadcast =
      !!bc?.running && bc.items.some((x) => (x.status === "pending" || x.status === "sending") && ids.includes(x.tabId));
    const inSplit = !!split && split.panes.some((id) => id && ids.includes(id));
    const n = list.length;
    setConfirm({
      title:
        scope === "all"
          ? "¿Cerrar todas las pestañas?"
          : scope === "others"
            ? "¿Cerrar las demás pestañas?"
            : `¿Cerrar las pestañas ${settings.tabLayout === "vertical" ? "de abajo" : "de la derecha"}?`,
      message: <CloseManyMessage scope={scope} summary={summary} broadcast={broadcast} split={inSplit} toolsOpen={toolsOpen} />,
      label: `Cerrar ${n} ${n === 1 ? "pestaña" : "pestañas"}`,
      danger: true,
      defaultCancel: true,
      action: run,
    });
  };

  // ---------- Difusión (envío a varias sesiones) ----------
  const bcTarget = useBroadcastTarget();
  const broadcastMode = bcTarget.mode !== "current";
  const workspace = useWorkspace();
  const [broadcast, setBroadcast] = useState<{ text: string; resolved: Resolved; declared?: Risk } | null>(null);
  const [bcDelay, setBcDelay] = useState(() => stored("broadcastDelay", 300));
  useEffect(() => persist("broadcastDelay", bcDelay), [bcDelay]);
  useEffect(() => {
    publishWorkspace({
      tabs: tabs.map((t) => ({ id: t.id, title: tabTitle(t), session: t.session, status: states[t.id]?.status ?? "connecting" })),
      panes: visiblePanes,
      activeId,
    });
  }, [tabs, states, activeId, visiblePanes]);
  /** Destino que muestran Notas y catálogo: la pestaña activa o el grupo de difusión. */
  const sendTarget = broadcastMode ? targetLabel(bcTarget, workspace) : activeConnected ? tabTitle(activeTab!) : null;
  const openBroadcast = (text: string, declared?: Risk) => {
    if (isBroadcastRunning()) return toast("Hay un envío a varias sesiones en curso", "error");
    const resolved = resolveTargets(bcTarget, tabs, (id) => states[id]?.status, activeId, visiblePanes);
    setBroadcast({ text, resolved, declared });
  };
  const startBroadcast = (deviceDelayMs: number) => {
    if (!broadcast) return;
    setBcDelay(deviceDelayMs);
    const { text, resolved } = broadcast;
    setBroadcast(null);
    // Mismo cuerpo que el envío normal: cada línea con Enter, también la última.
    const body = text.replace(/\s+$/, "") + "\n";
    runBroadcast(resolved.targets, resolved.skipped, body, { lineDelayMs: settings.sendLineDelay, deviceDelayMs }, (id) =>
      controllers.current.get(id),
    ).catch((e) => toast(String(e), "error"));
  };

  // Notas: resaltado según el fabricante de la sesión activa.
  const notesRules = useMemo(
    () =>
      compile([
        {
          id: "template-var",
          name: "Variable de plantilla",
          pattern: String.raw`\{\{\s*[\w.-]+\s*\}\}`,
          style: { color: "brightMagenta", bold: true, underline: true },
        },
        ...effectiveRules(
          { enabled: settings.highlightEnabled, schemes: settings.highlightSchemes, custom: settings.customRules },
          activeTab?.session.highlight,
        ),
      ]),
    [settings.highlightEnabled, settings.highlightSchemes, settings.customRules, activeTab?.session.highlight],
  );

  /** Envía texto de Notas a la sesión activa, confirmando bloques en equipos remotos. */
  /** Abre el diálogo para elegir destinos y modo del script. */
  const runScript = (script: string) => {
    if (scriptRun) return toast(`Ya se está ejecutando ${scriptRun.script}`, "error");
    setScriptLaunch(script);
  };

  const startScript = async (script: string, l: ScriptLaunch) => {
    setScriptLaunch(null);
    const targets = l.targets.flatMap((t) => {
      const ctrl = controllers.current.get(t.id);
      return ctrl && ctrl.isConnected() ? [{ conn: ctrl.connId(), platform: t.session.platform ?? null }] : [];
    });
    if (!targets.length) return toast("Conecta una sesión antes de ejecutar el script", "error");
    try {
      const run = await invoke<string>("run_script", {
        script,
        targets,
        options: { allowChanges: l.allowChanges, parallel: l.parallel, maxMinutes: l.maxMinutes, vaultType: l.vaultType },
      });
      setScriptRun({ run, script, targets: targets.length });
      const modes = [l.allowChanges ? "permite cambios" : "", l.vaultType ? "puede escribir contraseñas guardadas" : ""].filter(Boolean);
      toast(`Ejecutando ${script}${targets.length > 1 ? ` en ${targets.length} sesiones` : ""}${modes.length ? ` (${modes.join(", ")})` : ""}`);
    } catch (e) {
      toast(String(e), "error");
    }
  };

  // ---------- Catálogo: packs incluidos + packs del usuario ----------
  const [userPacks, setUserPacks] = useState<Pack[]>([]);
  const [packsOpen, setPacksOpen] = useState(false);
  const [cmdEdit, setCmdEdit] = useState<{ vendor: string; initial?: PackCommand } | null>(null);
  const [detecting, setDetecting] = useState(false);

  const loadPacks = useCallback(() => {
    invoke<unknown[]>("cmdpacks_list")
      .then((raw) =>
        setUserPacks(
          raw
            .map((r) => validatePack(r).pack)
            .filter((p): p is Pack => !!p),
        ),
      )
      .catch(() => {});
  }, []);
  useEffect(loadPacks, [loadPacks]);

  // Los packs incluidos (~300 KB de JSON) van en un chunk aparte que se carga tras el primer render.
  const [builtinPacks, setBuiltinPacks] = useState<Pack[]>([]);
  useEffect(() => {
    import("./lib/builtinPacks").then((m) => setBuiltinPacks(m.builtinPacks)).catch(console.error);
  }, []);

  const allPacks = useMemo(
    () => [...builtinPacks, ...userPacks.filter((p) => !builtinPacks.some((b) => b.id === p.id))],
    [builtinPacks, userPacks],
  );
  const catalog = useMemo(() => buildCatalog(allPacks, settings.disabledPacks), [allPacks, settings.disabledPacks]);

  /** Guarda la plataforma en la pestaña y, si es una sesión guardada, también en ella. */
  const setTabPlatform = (tabId: string, platform: string | null) => {
    const tab = tabs.find((t) => t.id === tabId);
    if (!tab) return;
    const session = { ...tab.session, platform: platform ?? undefined };
    setTabs((ts) => ts.map((t) => (t.id === tabId ? { ...t, session } : t)));
    if (sessions.some((x) => x.id === session.id)) updateSessions([{ ...sessions.find((x) => x.id === session.id)!, platform: session.platform }]);
  };

  const detectPlatformNow = async () => {
    const ctrl = activeCtrl();
    const vendor = catalog.find((v) => v.id === settings.catalogVendor);
    if (!ctrl || !activeTab || !vendor?.detectCommand) return toast("Este fabricante no tiene comando de detección", "error");
    setDetecting(true);
    try {
      const output = await runOnDevice(ctrl.connId(), vendor.detectCommand, 30);
      const found = detectPlatform(vendor, output);
      if (found) {
        setTabPlatform(activeTab.id, found.id);
        toast(`Plataforma detectada: ${found.label}`);
      } else {
        // Puede ser otro fabricante: se prueba con los demás.
        for (const other of catalog.filter((v) => v.id !== vendor.id && v.detectCommand === vendor.detectCommand)) {
          const p = detectPlatform(other, output);
          if (p) {
            update({ catalogVendor: other.id });
            setTabPlatform(activeTab.id, p.id);
            toast(`Plataforma detectada: ${other.name} ${p.label}`);
            return;
          }
        }
        toast("No se reconoció la plataforma; elígela a mano", "error");
      }
    } catch (e) {
      toast(`No se pudo detectar: ${e}`, "error");
    } finally {
      setDetecting(false);
    }
  };

  /** Agrega, edita o borra un comando en "Mis comandos" del fabricante. */
  const saveUserCommand = async (vendorId: string, cmd: PackCommand | null, replace?: string) => {
    const vendor = catalog.find((v) => v.id === vendorId);
    const id = `user-${vendorId}`;
    const current = userPacks.find((p) => p.id === id);
    let commands = (current?.commands ?? []).filter((c) => c.cmd !== (replace ?? cmd?.cmd));
    if (cmd) commands = [...commands, cmd];
    const pack: Pack = {
      format: "netterminal-commands",
      formatVersion: 1,
      id,
      name: `Mis comandos (${vendor?.name ?? vendorId})`,
      vendor: vendorId,
      vendorName: vendor?.name ?? vendorId,
      author: "Usuario",
      detectCommand: vendor?.detectCommand,
      platforms: vendor?.platforms ?? [],
      commands,
    };
    try {
      if (commands.length) await invoke("cmdpack_save", { pack });
      else await invoke("cmdpack_delete", { id });
      loadPacks();
      setCmdEdit(null);
    } catch (e) {
      toast(String(e), "error");
    }
  };

  /** Abre el catálogo con el fabricante de la sesión activa, si tiene uno definido. */
  const toggleCommands = () => {
    if (!commandsOpen && activeTab?.session.type === "local" && !activeTab.session.scp)
      update({ catalogVendor: localOsVendor() });
    else if (!commandsOpen && activeTab?.session.highlight && activeTab.session.highlight !== "default")
      update({ catalogVendor: vendorFor(activeTab.session.highlight) });
    setCommandsOpen((o) => !o);
  };

  /** `checked`: el riesgo ya se confirmó (catálogo) y no se vuelve a preguntar. */
  const sendToSession = (text: string, checked = false, declared?: Risk) => {
    // Las variables {{...}} se piden una sola vez, también al enviar a varias sesiones.
    const then = (t: string) => (broadcastMode ? openBroadcast(t, declared) : sendResolved(t, checked));
    if (templateVars(text).length) return setTemplate({ text, then });
    then(text);
  };

  const sendResolved = (text: string, checked = false) => {
    const ctrl = activeCtrl();
    if (!ctrl || !activeTab || !ctrl.isConnected()) return;
    // Cada línea se ejecuta con Enter, también la última.
    const trimmed = text.replace(/\s+$/, "");
    if (!trimmed) return;
    const body = trimmed + "\n";
    const lines = trimmed.split("\n");
    const session = activeTab.session;
    const go = () => {
      ctrl.send(body, settings.sendLineDelay).catch(console.error);
      ctrl.focus();
      // Historial por equipo: solo envíos explícitos (Notas, catálogo, botones), nunca teclas.
      if (!session.scp) invoke("cmd_history_add", { key: historyKey(session), command: trimmed }).catch(() => {});
    };
    const remote = activeTab.session.type !== "local";
    // Notas y botones pasan por el mismo motor de riesgo que el catálogo. Lo que puede
    // cortar servicio se confirma siempre; el resto según "Confirmar envío de varias líneas".
    const risk = remote && !checked ? computeRisk(trimmed) : "read";
    const ask = remote && (risk === "disruptive" || (settings.confirmSend && (lines.length > 1 || risk === "change")));
    if (ask) {
      const preview = lines.slice(0, 6).join("\n") + (lines.length > 6 ? "\n…" : "");
      setConfirm({
        title:
          risk === "disruptive"
            ? `Puede cortar servicio en ${tabTitle(activeTab)}`
            : lines.length > 1
              ? `¿Enviar ${lines.length} líneas a ${tabTitle(activeTab)}?`
              : `¿Enviar a ${tabTitle(activeTab)}?`,
        message: `${risk !== "read" ? `${riskLabel[risk]}.\n\n` : ""}${preview}`,
        label: "Enviar",
        danger: risk === "disruptive",
        action: go,
      });
    } else go();
  };

  // Atajos globales
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const action = shortcutFor(e);
      if (!action) return;
      e.preventDefault();
      const cycle = (step: number) => {
        if (!tabs.length) return;
        const i = tabs.findIndex((t) => t.id === activeId);
        setActiveId(tabs[(i + step + tabs.length) % tabs.length].id);
      };
      if (typeof action === "object") {
        if (tabs[action.tab]) setActiveId(tabs[action.tab].id);
        return;
      }
      switch (action) {
        case "palette":
          return setPaletteOpen((o) => !o);
        case "newTab":
          return newLocal();
        case "closeTab":
          return activeId && requestClose(activeId);
        case "closeAll":
          return requestCloseMany("all");
        case "settings":
          return setSettingsOpen(true);
        case "notes":
          return setNotesOpen((o) => !o);
        case "commands":
          return toggleCommands();
        case "tools":
          return activeId === "tools" ? closeTab("tools") : openTools();
        case "duplicateTab":
          return activeTab && openTab(activeTab.session);
        case "newSession":
          return setModal({});
        case "quickConnect":
          return setQuickOpen(true);
        case "toggleSidebar":
          return setSidebarOpen((o) => !o);
        case "find":
          return activeCtrl()?.openFind();
        case "nextTab":
          return cycle(1);
        case "prevTab":
          return cycle(-1);
        case "zoomIn":
          return update((s) => ({ fontSize: Math.min(s.fontSize + 1, 28) }));
        case "zoomOut":
          return update((s) => ({ fontSize: Math.max(s.fontSize - 1, 9) }));
        case "zoomReset":
          return update({ fontSize: 13 });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const saveSession = async (session: Session, connect: boolean, cred: CredChange = { action: "keep" }) => {
    try {
      let saved = await invoke<Session>("save_session", { session });
      // La contraseña va directo a la bóveda del backend; la sesión solo guarda el indicador.
      if (cred.action === "set") {
        try {
          await invoke("cred_set", { sessionId: saved.id, password: cred.password });
        } catch (err) {
          toast(`La sesión se guardó, pero no la contraseña: ${err}`, "error");
          // Sin una contraseña previa, el indicador no debe quedar activo.
          const before = sessions.find((x) => x.id === saved.id);
          if (!before?.save_password)
            saved = await invoke<Session>("save_session", { session: { ...saved, save_password: undefined } });
        }
      } else if (cred.action === "delete") {
        await invoke("cred_delete", { sessionId: saved.id }).catch((err) =>
          toast(`No se pudo borrar la contraseña guardada: ${err}`, "error"),
        );
      }
      setSessions((prev) =>
        prev.some((s) => s.id === saved.id) ? prev.map((s) => (s.id === saved.id ? saved : s)) : [...prev, saved],
      );
      // "Guardar como sesión…": la pestaña abierta pasa a ser la sesión guardada (sin reconectar).
      const tabId = modal?.tabId;
      if (tabId) setTabs((ts) => ts.map((t) => (t.id === tabId ? { ...t, session: saved } : t)));
      setModal(null);
      if (connect && !tabId) openTab(saved);
    } catch (err) {
      toast(`No se pudo guardar la sesión: ${err}`, "error");
    }
  };

  /** Importa sesiones omitiendo las que ya existen (mismo tipo, host/puerto o nombre). `updates`
   * son sesiones existentes ya combinadas con lo importado (reimportación con cambios). */
  const importSessions = async (list: Session[], updates: Session[] = []) => {
    const key = (s: Session) =>
      [s.type, s.host ?? "", s.port ?? "", s.serial_port ?? "", s.name.trim().toLowerCase()].join("|");
    const existing = new Set(sessions.map(key));
    const fresh: Session[] = [];
    for (const s of list) {
      if (existing.has(key(s))) continue;
      // No se importan los argumentos extra de ssh, los comandos al conectar ni los túneles:
      // una sesión compartida no debe poder inyectar opciones al cliente SSH, abrir puertos
      // ni enviar configuración al equipo sin que quien la importa lo revise.
      const { ssh_args: _dropped, on_connect: _cmds, scp: _scp, tunnels: _tunnels, save_password: _pw, ...safe } = s;
      fresh.push({ ...safe, id: "", created_at: "" });
      existing.add(key(s));
    }
    if (updates.length) {
      await invoke<Session[]>("update_sessions", { sessions: updates });
      // Cambió el destino: la contraseña guardada no debe seguir al host nuevo.
      for (const u of updates) {
        if (!u.save_password && sessions.find((s) => s.id === u.id)?.save_password)
          await invoke("cred_delete", { sessionId: u.id }).catch(() => {});
      }
    }
    // Una sola escritura aunque sean cientos de sesiones.
    setSessions(await invoke<Session[]>(fresh.length ? "add_sessions" : "list_sessions", { sessions: fresh }));
    return fresh.length;
  };

  const deleteSession = async (id: string) => {
    await invoke("delete_session", { id }).catch(console.error);
    setSessions((prev) => prev.filter((s) => s.id !== id));
  };

  const toggleLog = async () => {
    const ctrl = activeCtrl();
    if (!ctrl || !activeId) return;
    const enabled = !states[activeId]?.logPath;
    // Sesión cerrada: apagar el log solo evita que se reanude al reconectar.
    if (!enabled && states[activeId]?.status !== "connected") {
      const id = activeId;
      setStates((s) => (s[id] ? { ...s, [id]: { ...s[id], logPath: null } } : s));
      return;
    }
    try {
      const path = await invoke<string | null>("set_logging", {
        id: ctrl.connId(),
        enabled,
        ...logOptions(settings),
      });
      const id = activeId;
      setStates((s) => (s[id] ? { ...s, [id]: { ...s[id], logPath: path } } : s));
    } catch (err) {
      toast(`No se pudo activar el log: ${err}`, "error");
    }
    ctrl.focus();
  };

  const folders = useMemo(() => allFolders(sessions, settings.extraFolders), [sessions, settings.extraFolders]);

  // Estado de conexión por sesión guardada, para el punto verde en el árbol.
  const live = useMemo(() => {
    const rank: Record<ConnStatus, number> = { closed: 0, connecting: 1, connected: 2 };
    const out: Record<string, ConnStatus> = {};
    for (const t of tabs) {
      const st = states[t.id]?.status;
      if (st && (!out[t.session.id] || rank[st] > rank[out[t.session.id]])) out[t.session.id] = st;
    }
    return out;
  }, [tabs, states]);

  const updateSessions = async (changed: Session[]) => {
    try {
      setSessions(await invoke<Session[]>("update_sessions", { sessions: changed }));
    } catch (err) {
      toast(`No se pudo guardar: ${err}`, "error");
    }
  };

  const duplicateSession = async (s: Session) => {
    try {
      const saved = await invoke<Session>("save_session", {
        session: { ...s, id: "", name: `${s.name} (copia)`, created_at: "", save_password: undefined },
      });
      setSessions((prev) => [...prev, saved]);
      setModal({ session: saved });
    } catch (err) {
      toast(`No se pudo duplicar: ${err}`, "error");
    }
  };

  // Sesiones conectadas para las herramientas; memorizado para no cambiar en cada render.
  const terminals = useMemo(
    () =>
      tabs
        .filter((t) => t.session.type !== "local" && states[t.id]?.status === "connected")
        .map((t) => ({
          connId: controllers.current.get(t.id)?.connId() ?? "",
          name: tabTitle(t),
          host: t.session.host,
          highlight: t.session.highlight,
          session: t.session,
        }))
        .filter((t) => t.connId),
    [tabs, states],
  );

  const h = useHandlers({
    // En tandas de 5 cada 1,5 s: abrir 40 sesiones de golpe satura AAA/TACACS y la CPU.
    openMany: (list: Session[]) =>
      list.forEach((s, i) => (i < 5 ? openTab(s) : window.setTimeout(() => openTab(s), Math.floor(i / 5) * 1500))),
    newSession: (folder?: string) => setModal({ folder }),
    openQuick: () => setQuickOpen(true),
    saveTabAs: (id: string) => {
      const t = tabs.find((x) => x.id === id);
      if (t) setModal({ session: { ...t.session, name: t.title?.trim() || t.session.name }, tabId: id });
    },
    editSession: (session: Session) => setModal({ session }),
    duplicateSession,
    deleteSession: (s: Session) => deleteSession(s.id),
    updateSessions,
    setExtraFolders: (extraFolders: string[]) => update({ extraFolders }),
    requestClose,
    requestCloseMany,
    toggleSidebar: () => setSidebarOpen((o) => !o),
    setTabLayout: (tabLayout: Settings["tabLayout"]) => update({ tabLayout }),
    reorderTab: (from: string, to: string, after: boolean) => setTabs((ts) => moveItem(ts, from, to, after)),
    renameTab: (id: string, title: string | undefined) => setTabs((ts) => ts.map((t) => (t.id === id ? { ...t, title } : t))),
    duplicateTab: (id: string) => {
      const t = tabs.find((x) => x.id === id);
      if (t) openTab(t.session);
    },
    reconnectTab: (id: string) => controllers.current.get(id)?.reconnect(),
    disconnectTab: (id: string) => controllers.current.get(id)?.disconnect(),
    clearScrollback: (id: string) => controllers.current.get(id)?.clearScrollback(),
    resetTerminal: (id: string) => controllers.current.get(id)?.reset(),
    copyAll: (id: string) =>
      controllers.current
        .get(id)
        ?.copyAll()
        .then((n) => toast(`${plural(n, "línea copiada", "líneas copiadas")} al portapapeles`)),
    toolsConnId: () => {
      const c = lastTermRef.current ? controllers.current.get(lastTermRef.current) : undefined;
      return c?.isConnected() ? c.connId() : null;
    },
    scp: (req: ScpRequest) => {
      const s = req.session;
      openTab({
        ...s,
        // El gestor de archivos reconoce el fin de su transferencia por este id.
        id: req.transferId ?? `scp-${Date.now()}`,
        type: "local",
        name: req.mode === "shell" ? `SFTP ${s.name}` : `${req.mode === "sftp" ? "SFTP" : "SCP"} ${req.upload ? "→" : "←"} ${s.name}`,
        // Telnet/TCP usan su propio puerto: SCP siempre va por SSH.
        port: s.type === "ssh" ? s.port : 22,
        highlight: "off",
        on_connect: undefined,
        auto_reconnect: false,
        scp: { upload: req.upload, files: req.files, remote_dir: req.remoteDir, mode: req.mode ?? "scp" },
      });
      toast(`Pestaña ${req.mode && req.mode !== "scp" ? "SFTP" : "SCP"} abierta: escribe la contraseña del equipo ahí`);
    },
    setVendor: (catalogVendor: string) => update({ catalogVendor }),
    setPlatform: (platform: string | null) => activeTab && setTabPlatform(activeTab.id, platform),
    detect: () => detectPlatformNow(),
    setFavorites: (favCommands: string[]) => update({ favCommands }),
    closeCommands: () => {
      setCommandsOpen(false);
      activeCtrl()?.focus();
    },
    runCommand: (c: CatalogEntry, cmd: string) => {
      // En difusión el diálogo propio confirma el riesgo con la cantidad de equipos.
      if (broadcastMode) return sendToSession(cmd, false, c.risk);
      if (c.risk === "read") return sendToSession(cmd);
      setConfirm({
        title: c.risk === "disruptive" ? "Este comando puede cortar servicio" : "Este comando cambia configuración o estado",
        message: `${riskLabel[c.risk]} en ${activeTab ? tabTitle(activeTab) : "la sesión"}:\n\n${cmd}`,
        label: "Ejecutar",
        danger: c.risk === "disruptive",
        action: () => sendToSession(cmd, true),
      });
    },
    typeCommand: (cmd: string) => {
      const type = (text: string) => activeCtrl()?.type(text);
      if (templateVars(cmd).length) setTemplate({ text: cmd, then: type });
      else type(cmd);
    },
    addCommand: (vendor: string) => setCmdEdit({ vendor }),
    editCommand: (c: CatalogEntry) => setCmdEdit({ vendor: settings.catalogVendor, initial: c }),
    openPacks: () => setPacksOpen(true),
    resizeNotes: (w: number) => setNotesWidth(Math.max(260, Math.min(w, window.innerWidth * 0.7))),
    closeNotes: () => {
      setNotesOpen(false);
      activeCtrl()?.focus();
    },
    sendToSession,
    capture: () => activeCtrl()?.getSelection() ?? "",
    runMacro: (m: Macro) => (m.kind === "script" ? m.script && runScript(m.script) : m.text && sendToSession(m.text)),
    runScript,
    stopScript: () => scriptRun && invoke("stop_script", { run: scriptRun.run }).catch(() => {}),
    deleteMacro: (m: Macro) => update((s) => ({ macros: s.macros.filter((x) => x.id !== m.id) })),
    toggleLog,
    sendBreak: () => {
      const ctrl = activeCtrl();
      if (!ctrl) return;
      invoke("send_break", { id: ctrl.connId() }).catch((e) => toast(String(e), "error"));
      ctrl.focus();
    },
    reconnect: () => activeCtrl()?.reconnect(),
    disconnect: () => activeCtrl()?.disconnect(),
    find: () => activeCtrl()?.openFind(),
    openSettings: () => setSettingsOpen(true),
    openAi: () => {
      setSettingsSection("ai");
      setSettingsOpen(true);
    },
    toggleNotes: () => setNotesOpen((o) => !o),
    toggleCommands,
    changeSplit,
    pickPane,
    cancelBroadcast: () => setBroadcast(null),
    startBroadcast,
    openImport: () => setImportOpen(true),
    // Activa "algoritmos legacy" en la pestaña y, si es una sesión guardada, la deja guardada.
    enableLegacy: (tabId: string) => {
      const tab = tabs.find((t) => t.id === tabId);
      if (!tab) return;
      const session = { ...tab.session, legacy_ssh: true };
      setTabs((ts) => ts.map((t) => (t.id === tabId ? { ...t, session } : t)));
      if (sessions.some((x) => x.id === session.id)) updateSessions([session]);
      toast(`Compatibilidad con equipos antiguos activada en ${session.name}`);
    },
  });

  // Mismos datos y acciones para la barra horizontal y la columna de pestañas verticales.
  const tabBarProps: TabBarProps = {
    tabs,
    states,
    activeId,
    onSelect: setActiveId,
    onClose: h.requestClose,
    onCloseMany: h.requestCloseMany,
    onNew: newLocal,
    onQuickConnect: h.openQuick,
    onNewSession: h.newSession,
    onSaveAs: h.saveTabAs,
    onToggleSidebar: h.toggleSidebar,
    toolsOpen,
    onOpenTools: openTools,
    alerts: monitors.downCount,
    onRename: h.renameTab,
    onReorder: h.reorderTab,
    onDuplicate: h.duplicateTab,
    onReconnect: h.reconnectTab,
    onDisconnect: h.disconnectTab,
    onClearScrollback: h.clearScrollback,
    onResetTerminal: h.resetTerminal,
    onCopyAll: h.copyAll,
    activity,
    split: split?.layout ?? null,
    onSplit: h.changeSplit,
    alerted,
    tabLayout: settings.tabLayout,
    onTabLayout: h.setTabLayout,
  };

  return (
    <div className="h-full flex bg-bg text-fg">
      {sidebarOpen && (
        <Sidebar
          sessions={sessions}
          extraFolders={settings.extraFolders}
          live={live}
          onOpen={openTab}
          onOpenMany={h.openMany}
          onNew={h.newSession}
          onQuickConnect={h.openQuick}
          onEdit={h.editSession}
          onDuplicate={h.duplicateSession}
          onDelete={h.deleteSession}
          onUpdateSessions={h.updateSessions}
          onSetExtraFolders={h.setExtraFolders}
          onConfirm={setConfirm}
          onImportFile={h.openImport}
        />
      )}

      <main className="flex-1 min-w-0 flex flex-col">
        {update_ && (
          <div className="shrink-0 border-b border-line bg-selected">
            <div className="flex items-center gap-3 px-3 h-9 text-[12.5px]">
              <Sparkles size={14} className="text-accent shrink-0" />
              <span className="flex-1 truncate">
                Nueva versión <b>{update_.latest}</b> disponible (tienes {update_.current}).
              </span>
              {update_.notes && (
                <button className="text-accent hover:underline" onClick={() => setShowNotes(!showNotes)}>
                  {showNotes ? "Ocultar novedades" : "Ver novedades"}
                </button>
              )}
              {installing !== null ? (
                <span className="text-accent font-medium tabular-nums">Descargando… {installing}%</span>
              ) : update_.supported ? (
                <>
                  <button className="text-muted hover:text-fg hover:underline" onClick={() => openUrl(update_.url)}>
                    Ver release
                  </button>
                  <button className="px-2.5 h-6 rounded-md bg-accent text-accent-fg font-medium hover:opacity-90" onClick={installUpdate}>
                    Actualizar y reiniciar
                  </button>
                </>
              ) : (
                <button
                  className="text-accent font-medium hover:underline"
                  title={update_.reason ?? undefined}
                  onClick={() => openUrl(update_.url)}
                >
                  Descargar
                </button>
              )}
              <button
                className="text-muted hover:text-fg"
                title="Omitir esta versión"
                onClick={() => {
                  update({ updateDismissed: update_.latest });
                  setUpdate(null);
                }}
              >
                <XIcon size={14} />
              </button>
            </div>
            {showNotes && (
              <pre className="px-10 pb-3 max-h-48 overflow-y-auto text-[12px] whitespace-pre-wrap font-sans select-text">{update_.notes}</pre>
            )}
          </div>
        )}
        <BroadcastBar />
        <TabBar {...tabBarProps} />

        <div className="flex-1 min-h-0 flex">
        {settings.tabLayout === "vertical" && <VerticalTabs {...tabBarProps} />}
        <div className="relative flex-1 min-w-0">
          {tabs.map((t) => {
            const pane = splitOn ? split!.panes.indexOf(t.id) : -1;
            return (
            <TerminalView
              key={t.id}
              id={t.id}
              session={t.session}
              active={t.id === activeId}
              visible={splitOn ? pane >= 0 : t.id === activeId}
              rect={pane >= 0 ? paneRect(split!.layout, pane) : undefined}
              onFocusPane={setActiveId}
              settings={settings}
              theme={preset.theme}
              onStatus={onStatus}
              onLog={onLog}
              logPath={states[t.id]?.logPath ?? null}
              onActivity={markActivity}
              onEnableLegacy={h.enableLegacy}
              register={register}
              catalog={catalog}
            />
            );
          })}
          {splitOn && (
            <SplitPanes split={split!} tabs={tabs} states={states} activeId={activeId} onPick={h.pickPane} onFocus={setActiveId} />
          )}
          {toolsOpen && (
            <Suspense fallback={null}>
              <ToolsView
                active={activeId === "tools"}
                settings={settings}
                update={update}
                monitors={monitors}
                connId={h.toolsConnId}
                onConfirm={setConfirm}
                onOpenSession={openTab}
                sessions={sessions}
                onScp={h.scp}
                terminals={terminals}
              />
            </Suspense>
          )}
          {tabs.length === 0 && activeId !== "tools" && (
            <EmptyState onLocal={newLocal} onPalette={() => setPaletteOpen(true)} onQuick={h.openQuick} onNew={() => setModal({})} onTools={openTools} />
          )}
        </div>
        {commandsOpen && (
          <CommandsPanel
            width={notesWidth}
            catalog={catalog}
            vendor={settings.catalogVendor}
            onVendor={h.setVendor}
            platform={activeTab?.session.platform ?? null}
            onPlatform={h.setPlatform}
            onDetect={activeConnected ? h.detect : null}
            detecting={detecting}
            favorites={settings.favCommands}
            onFavorites={h.setFavorites}
            target={sendTarget}
            onClose={h.closeCommands}
            onRun={h.runCommand}
            onType={h.typeCommand}
            onAdd={h.addCommand}
            onEdit={h.editCommand}
            onPacks={h.openPacks}
          />
        )}
        {notesOpen && (
          <NotesPanel
            width={notesWidth}
            onResize={h.resizeNotes}
            onClose={h.closeNotes}
            compiled={notesRules}
            theme={preset.theme}
            font={settings.fontFamily}
            fontSize={Math.max(11, settings.fontSize - 1)}
            target={broadcastMode ? sendTarget : activeConnected ? activeTab!.session.name : null}
            onSend={h.sendToSession}
            onCapture={h.capture}
          />
        )}
        </div>

        {settings.showButtonBar && (
          <ButtonBar
            macros={settings.macros}
            connected={activeConnected || broadcastMode}
            running={scriptRun}
            onRun={h.runMacro}
            onRunScript={h.runScript}
            onStopScript={h.stopScript}
            onEdit={setMacroEdit}
            onDelete={h.deleteMacro}
            onNotice={toast}
            onDeleteMacros={(ids) => update((s) => ({ macros: s.macros.filter((x) => !ids.includes(x.id)) }))}
          />
        )}

        <StatusBar
          tab={activeTab}
          state={activeId ? states[activeId] : undefined}
          onToggleLog={h.toggleLog}
          onBreak={h.sendBreak}
          onReconnect={h.reconnect}
          onDisconnect={h.disconnect}
          onFind={h.find}
          onSettings={h.openSettings}
          aiEnabled={settings.mcpEnabled}
          onAi={h.openAi}
          notesOpen={notesOpen}
          onNotes={h.toggleNotes}
          commandsOpen={commandsOpen}
          onCommands={h.toggleCommands}
          onResend={h.sendToSession}
          onSaveAs={activeTab ? () => h.saveTabAs(activeTab.id) : undefined}
        />
      </main>

      {modal && (
        <SessionModal
          initial={modal.session}
          title={modal.tabId ? "Guardar como sesión" : undefined}
          defaultFolder={modal.folder}
          folders={folders}
          onClose={() => setModal(null)}
          onSave={saveSession}
        />
      )}
      {settingsOpen && (
        <Suspense fallback={null}>
          <SettingsModal
            settings={settings}
            appDark={dark}
            termTheme={preset.theme}
            sessions={sessions}
            onImportSessions={importSessions}
            onImportFile={h.openImport}
            initialSection={settingsSection}
            mcpStatus={mcpStatus}
            onChange={update}
            onClose={() => {
              setSettingsOpen(false);
              setSettingsSection(undefined);
              activeCtrl()?.focus();
            }}
          />
        </Suspense>
      )}
      {confirm && (
        <ConfirmDialog
          title={confirm.title}
          message={confirm.message}
          confirmLabel={confirm.label}
          danger={confirm.danger}
          defaultCancel={confirm.defaultCancel}
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            confirm.action();
            setConfirm(null);
          }}
        />
      )}
      {macroEdit !== undefined && (
        <MacroModal
          initial={macroEdit}
          onClose={() => setMacroEdit(undefined)}
          onSave={(m) => {
            update((s) => ({
              macros: s.macros.some((x) => x.id === m.id)
                ? s.macros.map((x) => (x.id === m.id ? m : x))
                : [...s.macros, m],
            }));
            setMacroEdit(undefined);
          }}
        />
      )}
      {broadcast && (
        <BroadcastDialog
          text={broadcast.text}
          resolved={broadcast.resolved}
          declared={broadcast.declared}
          delayMs={bcDelay}
          onCancel={h.cancelBroadcast}
          onConfirm={h.startBroadcast}
        />
      )}
      <ScriptPrompts toast={toast} />
      {scriptLaunch && (
        <ScriptLaunchDialog script={scriptLaunch} onCancel={() => setScriptLaunch(null)} onRun={(l) => startScript(scriptLaunch, l)} />
      )}
      {approvals[0] && (
        <ApprovalDialog
          key={approvals[0].id}
          request={approvals[0]}
          pending={approvals.length}
          onDecide={(approved) => {
            invoke("mcp_decide", { id: approvals[0].id, approved }).catch((e) => toast(String(e), "error"));
            setApprovals((a) => a.slice(1));
          }}
        />
      )}
      {toasts.length > 0 && (
        <div className="fixed bottom-16 right-4 z-40 flex flex-col items-end gap-1.5 pointer-events-none">
          {toasts.map((t) => (
            <div
              key={t.id}
              className={`max-w-[420px] px-3 py-2 rounded-lg border shadow-pop text-[12px] bg-panel ${
                t.kind === "error" ? "border-danger text-danger" : t.kind === "ai" ? "border-accent" : "border-line"
              }`}
            >
              {t.text}
            </div>
          ))}
        </div>
      )}
      {packsOpen && (
        <PacksModal
          packs={allPacks}
          disabled={settings.disabledPacks}
          onToggle={(id, enabled) =>
            update((s) => ({ disabledPacks: enabled ? s.disabledPacks.filter((x) => x !== id) : [...s.disabledPacks, id] }))
          }
          onChanged={loadPacks}
          onClose={() => setPacksOpen(false)}
        />
      )}
      {cmdEdit && (
        <CommandEditor
          vendorName={catalog.find((v) => v.id === cmdEdit.vendor)?.name ?? cmdEdit.vendor}
          platforms={catalog.find((v) => v.id === cmdEdit.vendor)?.platforms ?? []}
          initial={cmdEdit.initial}
          onClose={() => setCmdEdit(null)}
          onSave={(c) => saveUserCommand(cmdEdit.vendor, c, cmdEdit.initial?.cmd)}
          onDelete={cmdEdit.initial ? () => saveUserCommand(cmdEdit.vendor, null, cmdEdit.initial!.cmd) : undefined}
        />
      )}
      {template !== null && (
        <TemplateDialog
          text={template.text}
          onCancel={() => setTemplate(null)}
          onSubmit={(filled) => {
            const then = template.then;
            setTemplate(null);
            then(filled);
          }}
        />
      )}
      {importOpen && (
        <Suspense fallback={null}>
          <ImportDialog folders={folders} sessions={sessions} onImport={importSessions} onClose={() => setImportOpen(false)} />
        </Suspense>
      )}
      {paletteOpen && (
        <CommandPalette
          sessions={sessions}
          onClose={() => setPaletteOpen(false)}
          onOpen={openTab}
          actions={
            tabs.length
              ? [
                  {
                    label: "Cerrar todas las sesiones",
                    detail: `${tabs.length} ${tabs.length === 1 ? "pestaña abierta" : "pestañas abiertas"}; pide confirmación si hay conexiones activas`,
                    shortcut: closeAllLabel,
                    run: () => requestCloseMany("all"),
                  },
                ]
              : []
          }
        />
      )}
      {quickOpen && <QuickConnectDialog onClose={() => setQuickOpen(false)} onOpen={openTab} />}
    </div>
  );
}

function EmptyState({
  onLocal,
  onPalette,
  onQuick,
  onNew,
  onTools,
}: {
  onLocal: () => void;
  onPalette: () => void;
  onQuick: () => void;
  onNew: () => void;
  onTools: () => void;
}) {
  const items: [React.ReactNode, string, () => void][] = [
    ["Conexión rápida sin guardar", `${modLabel}O`, onQuick],
    ["Buscar sesión", `${modLabel}K`, onPalette],
    ["Nueva sesión guardada", `${modLabel}N`, onNew],
    ["Terminal local", `${modLabel}T`, onLocal],
    ["Herramientas de red", `${modLabel}E`, onTools],
  ];
  return (
    <div className="absolute inset-0 grid place-items-center">
      <div className="w-[340px]">
        <img src={logo} alt="" className="w-16 h-16 -ml-2 mb-2" draggable={false} />
        <h1 className="text-[18px] font-semibold mb-1">NetTerminal</h1>
        <p className="text-muted mb-5">SSH, Telnet y Serial sin complicaciones.</p>
        <div className="space-y-1">
          {items.map(([label, key, fn], i) => (
            <button
              key={i}
              onClick={fn}
              className="w-full flex items-center justify-between px-3 h-9 rounded-lg hover:bg-hover text-left"
            >
              {label}
              <kbd className="text-[11px] text-muted font-sans">{key}</kbd>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
