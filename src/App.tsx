import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Sidebar } from "./components/Sidebar";
import { TabBar } from "./components/TabBar";
import { StatusBar } from "./components/StatusBar";
import { TerminalView, TermController } from "./components/TerminalView";
import { SessionModal } from "./components/SessionModal";
import { CommandPalette } from "./components/CommandPalette";
import { SettingsModal } from "./components/SettingsModal";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { NotesPanel } from "./components/NotesPanel";
import { TemplateDialog, templateVars } from "./components/TemplateDialog";
import { compile, effectiveRules } from "./lib/highlight";
import { allFolders } from "./lib/folders";
import { ButtonBar } from "./components/ButtonBar";
import { MacroModal } from "./components/MacroModal";
import { ApprovalDialog, ApprovalRequest } from "./components/ApprovalDialog";
import type { Section } from "./components/SettingsModal";
import type { Macro } from "./lib/settings";
import { listen } from "@tauri-apps/api/event";
import { ConnStatus, Session, Tab, TabState } from "./types";
import { modLabel, shortcutFor } from "./lib/platform";
import { resolvePreset, useSystemDark } from "./lib/theme";
import { Settings, useSettings } from "./lib/settings";
import logo from "./assets/logo.svg";
import "./App.css";

const LOCAL: Session = { id: "local", name: "Terminal local", type: "local", created_at: "" };

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
  const [scriptRun, setScriptRun] = useState<{ run: string; script: string } | null>(null);
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
    message: string;
    label: string;
    danger?: boolean;
    action: () => void;
  } | null>(null);
  const [template, setTemplate] = useState<string | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [states, setStates] = useState<Record<string, TabState>>({});
  const [activeId, setActiveId] = useState<string | null>(null);
  const [modal, setModal] = useState<{ session?: Session; folder?: string } | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(() => stored("sidebar", true));
  const controllers = useRef(new Map<string, TermController>());

  useEffect(() => persist("sidebar", sidebarOpen), [sidebarOpen]);
  const [notesOpen, setNotesOpen] = useState(() => stored("notesOpen", false));
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

  useEffect(() => {
    invoke<Session[]>("list_sessions").then(setSessions).catch(console.error);
  }, []);

  const openTab = useCallback((session: Session) => {
    const id = `t${++tabSeq}`;
    setTabs((t) => [...t, { id, session }]);
    setStates((s) => ({ ...s, [id]: { status: "connecting", logPath: null } }));
    setActiveId(id);
  }, []);

  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;

  useEffect(() => {
    const subs = [
      listen<ApprovalRequest>("mcp-approval", (e) => setApprovals((a) => [...a, e.payload])),
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
        const { kind, message, script } = e.payload;
        if (kind === "log") toast(`${script}: ${message}`);
        else {
          setScriptRun(null);
          toast(`${script}: ${message}`, kind === "error" ? "error" : "info");
        }
      }),
    ];
    return () => subs.forEach((u) => u.then((f) => f()));
  }, [openTab, toast]);


  const closeTab = useCallback((id: string) => {
    setTabs((prev) => {
      const idx = prev.findIndex((t) => t.id === id);
      const next = prev.filter((t) => t.id !== id);
      setActiveId((cur) => (cur === id ? (next[Math.min(idx, next.length - 1)]?.id ?? null) : cur));
      return next;
    });
    setStates(({ [id]: _, ...rest }) => rest);
  }, []);

  // Evita cortar por accidente una sesión remota activa.
  const requestClose = (id: string) => {
    const tab = tabs.find((t) => t.id === id);
    const risky = tab && tab.session.type !== "local" && states[id]?.status === "connected";
    if (settings.confirmClose && risky)
      setConfirm({
        title: "¿Cerrar la sesión?",
        message: `Se cortará la conexión con ${tab.session.name}.`,
        label: "Cerrar sesión",
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
        ? { ...s, [id]: { status, logPath: status === "closed" ? null : s[id].logPath } }
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
  const runScript = async (script: string) => {
    const ctrl = activeCtrl();
    if (!ctrl || !ctrl.isConnected()) return toast("Conecta una sesión antes de ejecutar el script", "error");
    try {
      const run = await invoke<string>("run_script", { id: ctrl.connId(), script });
      setScriptRun({ run, script });
      toast(`Ejecutando ${script}`);
    } catch (e) {
      toast(String(e), "error");
    }
  };

  const sendToSession = (text: string) => {
    if (templateVars(text).length) return setTemplate(text);
    sendResolved(text);
  };

  const sendResolved = (text: string) => {
    const ctrl = activeCtrl();
    if (!ctrl || !activeTab || !ctrl.isConnected()) return;
    // Cada línea se ejecuta con Enter, también la última.
    const trimmed = text.replace(/\s+$/, "");
    if (!trimmed) return;
    const body = trimmed + "\n";
    const lines = trimmed.split("\n");
    const go = () => {
      ctrl.send(body, settings.sendLineDelay).catch(console.error);
      ctrl.focus();
    };
    if (settings.confirmSend && lines.length > 1 && activeTab.session.type !== "local") {
      const preview = lines.slice(0, 4).join("\n") + (lines.length > 4 ? "\n…" : "");
      setConfirm({
        title: `¿Enviar ${lines.length} líneas a ${activeTab.session.name}?`,
        message: preview,
        label: "Enviar",
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
        case "settings":
          return setSettingsOpen(true);
        case "notes":
          return setNotesOpen((o) => !o);
        case "duplicateTab":
          return activeTab && openTab(activeTab.session);
        case "newSession":
          return setModal({});
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

  const saveSession = async (session: Session, connect: boolean) => {
    try {
      const saved = await invoke<Session>("save_session", { session });
      setSessions((prev) =>
        prev.some((s) => s.id === saved.id) ? prev.map((s) => (s.id === saved.id ? saved : s)) : [...prev, saved],
      );
      setModal(null);
      if (connect) openTab(saved);
    } catch (err) {
      alert(`No se pudo guardar la sesión: ${err}`);
    }
  };

  /** Importa sesiones omitiendo las que ya existen (mismo tipo, host/puerto o nombre). */
  const importSessions = async (list: Session[]) => {
    const key = (s: Session) =>
      [s.type, s.host ?? "", s.port ?? "", s.serial_port ?? "", s.name.trim().toLowerCase()].join("|");
    const existing = new Set(sessions.map(key));
    let added = 0;
    for (const s of list) {
      if (existing.has(key(s))) continue;
      // Los argumentos extra de ssh no se importan: una sesión compartida no debe
      // poder inyectar opciones al cliente SSH de quien la importa.
      const { ssh_args: _dropped, ...safe } = s;
      await invoke("save_session", { session: { ...safe, id: "", created_at: "" } });
      existing.add(key(s));
      added++;
    }
    setSessions(await invoke<Session[]>("list_sessions"));
    return added;
  };

  const deleteSession = async (id: string) => {
    await invoke("delete_session", { id }).catch(console.error);
    setSessions((prev) => prev.filter((s) => s.id !== id));
  };

  const toggleLog = async () => {
    const ctrl = activeCtrl();
    if (!ctrl || !activeId) return;
    const enabled = !states[activeId]?.logPath;
    try {
      const path = await invoke<string | null>("set_logging", {
        id: ctrl.connId(),
        enabled,
        timestamps: settings.logTimestamps,
      });
      const id = activeId;
      setStates((s) => (s[id] ? { ...s, [id]: { ...s[id], logPath: path } } : s));
    } catch (err) {
      alert(`No se pudo activar el log: ${err}`);
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
      alert(`No se pudo guardar: ${err}`);
    }
  };

  const duplicateSession = async (s: Session) => {
    const saved = await invoke<Session>("save_session", {
      session: { ...s, id: "", name: `${s.name} (copia)`, created_at: "" },
    });
    setSessions((prev) => [...prev, saved]);
    setModal({ session: saved });
  };

  return (
    <div className="h-full flex bg-bg text-fg">
      {sidebarOpen && (
        <Sidebar
          sessions={sessions}
          extraFolders={settings.extraFolders}
          live={live}
          onOpen={openTab}
          onOpenMany={(list) => list.forEach(openTab)}
          onNew={(folder) => setModal({ folder })}
          onEdit={(session) => setModal({ session })}
          onDuplicate={duplicateSession}
          onDelete={(s) => deleteSession(s.id)}
          onUpdateSessions={updateSessions}
          onSetExtraFolders={(extraFolders) => update({ extraFolders })}
          onConfirm={setConfirm}
        />
      )}

      <main className="flex-1 min-w-0 flex flex-col">
        <TabBar
          tabs={tabs}
          states={states}
          activeId={activeId}
          onSelect={setActiveId}
          onClose={requestClose}
          onNew={newLocal}
          onToggleSidebar={() => setSidebarOpen((o) => !o)}
        />

        <div className="flex-1 min-h-0 flex">
        <div className="relative flex-1 min-w-0">
          {tabs.map((t) => (
            <TerminalView
              key={t.id}
              id={t.id}
              session={t.session}
              active={t.id === activeId}
              settings={settings}
              theme={preset.theme}
              onStatus={onStatus}
              onLog={onLog}
              register={register}
            />
          ))}
          {tabs.length === 0 && <EmptyState onLocal={newLocal} onPalette={() => setPaletteOpen(true)} onNew={() => setModal({})} />}
        </div>
        {notesOpen && (
          <NotesPanel
            width={notesWidth}
            onResize={(w) => setNotesWidth(Math.max(260, Math.min(w, window.innerWidth * 0.7)))}
            onClose={() => {
              setNotesOpen(false);
              activeCtrl()?.focus();
            }}
            compiled={notesRules}
            theme={preset.theme}
            font={settings.fontFamily}
            fontSize={Math.max(11, settings.fontSize - 1)}
            target={activeConnected ? activeTab!.session.name : null}
            onSend={sendToSession}
            onCapture={() => activeCtrl()?.getSelection() ?? ""}
          />
        )}
        </div>

        {settings.showButtonBar && (
          <ButtonBar
            macros={settings.macros}
            connected={activeConnected}
            running={scriptRun}
            onRun={(m) => (m.kind === "script" ? m.script && runScript(m.script) : m.text && sendToSession(m.text))}
            onRunScript={runScript}
            onStopScript={() => scriptRun && invoke("stop_script", { run: scriptRun.run })}
            onEdit={setMacroEdit}
            onDelete={(m) => update((s) => ({ macros: s.macros.filter((x) => x.id !== m.id) }))}
          />
        )}

        <StatusBar
          tab={activeTab}
          state={activeId ? states[activeId] : undefined}
          onToggleLog={toggleLog}
          onBreak={() => {
            const ctrl = activeCtrl();
            if (!ctrl) return;
            invoke("send_break", { id: ctrl.connId() }).catch((e) => alert(e));
            ctrl.focus();
          }}
          onReconnect={() => activeCtrl()?.reconnect()}
          onFind={() => activeCtrl()?.openFind()}
          onSettings={() => setSettingsOpen(true)}
          aiEnabled={settings.mcpEnabled}
          onAi={() => {
            setSettingsSection("ai");
            setSettingsOpen(true);
          }}
          notesOpen={notesOpen}
          onNotes={() => setNotesOpen((o) => !o)}
        />
      </main>

      {modal && (
        <SessionModal
          initial={modal.session}
          defaultFolder={modal.folder}
          folders={folders}
          onClose={() => setModal(null)}
          onSave={saveSession}
        />
      )}
      {settingsOpen && (
        <SettingsModal
          settings={settings}
          appDark={dark}
          termTheme={preset.theme}
          sessions={sessions}
          onImportSessions={importSessions}
          initialSection={settingsSection}
          mcpStatus={mcpStatus}
          onChange={update}
          onClose={() => {
            setSettingsOpen(false);
            setSettingsSection(undefined);
            activeCtrl()?.focus();
          }}
        />
      )}
      {confirm && (
        <ConfirmDialog
          title={confirm.title}
          message={confirm.message}
          confirmLabel={confirm.label}
          danger={confirm.danger}
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
      {approvals[0] && (
        <ApprovalDialog
          key={approvals[0].id}
          request={approvals[0]}
          pending={approvals.length}
          onDecide={(approved) => {
            invoke("mcp_decide", { id: approvals[0].id, approved });
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
      {template !== null && (
        <TemplateDialog
          text={template}
          onCancel={() => setTemplate(null)}
          onSubmit={(filled) => {
            setTemplate(null);
            sendResolved(filled);
          }}
        />
      )}
      {paletteOpen && (
        <CommandPalette sessions={sessions} onClose={() => setPaletteOpen(false)} onOpen={openTab} />
      )}
    </div>
  );
}

function EmptyState({ onLocal, onPalette, onNew }: { onLocal: () => void; onPalette: () => void; onNew: () => void }) {
  const items: [string, string, () => void][] = [
    ["Conexión rápida o buscar sesión", `${modLabel}K`, onPalette],
    ["Nueva sesión guardada", `${modLabel}N`, onNew],
    ["Terminal local", `${modLabel}T`, onLocal],
  ];
  return (
    <div className="absolute inset-0 grid place-items-center">
      <div className="w-[340px]">
        <img src={logo} alt="" className="w-16 h-16 -ml-2 mb-2" draggable={false} />
        <h1 className="text-[18px] font-semibold mb-1">NetTerminal</h1>
        <p className="text-muted mb-5">SSH, Telnet y Serial sin complicaciones.</p>
        <div className="space-y-1">
          {items.map(([label, key, fn]) => (
            <button
              key={label}
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
