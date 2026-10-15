import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Activity, ArrowDownUp, Calculator, Gauge, Network, Puzzle, Radar, ScrollText } from "lucide-react";
import { TopologyTool } from "./TopologyTool";
import type { Session } from "../../types";
import { ModuleId, Settings, SpeedResult } from "../../lib/settings";
import { MonitorStatus, MonitorTarget, Sample } from "../../lib/monitors";
import { MonitorTool } from "./MonitorTool";
import { DiagTool } from "./DiagTool";
import { SubnetTool } from "./SubnetTool";
import { PerfTool } from "./PerfTool";
import { TransferTool } from "./TransferTool";
import { SyslogTool } from "./SyslogTool";
import { PluginsTool } from "./PluginsTool";
import type { ScpRequest, TerminalRef } from "./FileManager";

const NAV: { id: ModuleId; label: string; Icon: typeof Activity }[] = [
  { id: "monitor", label: "Monitoreo", Icon: Activity },
  { id: "diag", label: "Diagnóstico", Icon: Radar },
  { id: "topology", label: "Topología", Icon: Network },
  { id: "subnet", label: "Subredes", Icon: Calculator },
  { id: "perf", label: "Velocidad", Icon: Gauge },
  { id: "transfer", label: "TFTP / HTTP", Icon: ArrowDownUp },
  { id: "syslog", label: "Syslog", Icon: ScrollText },
  { id: "plugins", label: "Plugins", Icon: Puzzle },
];

interface Props {
  active: boolean;
  settings: Settings;
  update: (p: Partial<Settings> | ((s: Settings) => Partial<Settings>)) => void;
  monitors: {
    samples: Record<string, Sample[]>;
    status: Record<string, MonitorStatus>;
    clear: (id: string) => void;
    silence: (id: string) => void;
  };
  connId: () => string | null;
  terminals: TerminalRef[];
  sessions: Session[];
  onScp: (req: ScpRequest) => void;
  onOpenSession: (s: Session) => void;
  onConfirm: (req: { title: string; message: string; label: string; danger?: boolean; action: () => void }) => void;
}

/**
 * Pestaña de herramientas. Cada módulo se monta al visitarlo y luego se mantiene
 * vivo oculto, para no perder servidores, logs ni mediciones al cambiar de sección.
 */
export function ToolsView({ active, settings, update, monitors, connId, terminals, sessions, onConfirm, onScp, onOpenSession }: Props) {
  const enabled = NAV.filter((n) => settings.modules[n.id] !== false);
  const [current, setCurrent] = useState<ModuleId>(enabled[0]?.id ?? "monitor");
  const [visited, setVisited] = useState<Set<ModuleId>>(new Set([current]));
  const [running, setRunning] = useState<string[]>([]);

  const refreshRunning = useCallback(() => {
    invoke<string[]>("server_running").then(setRunning);
  }, []);
  useEffect(refreshRunning, [refreshRunning]);

  const go = (id: ModuleId) => {
    setCurrent(id);
    setVisited((v) => new Set(v).add(id));
  };

  useEffect(() => {
    if (!enabled.some((n) => n.id === current) && enabled[0]) go(enabled[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.modules]);

  const pane = (id: ModuleId) => {
    switch (id) {
      case "monitor":
        return (
          <MonitorTool
            targets={settings.monitors}
            samples={monitors.samples}
            status={monitors.status}
            onChange={(m: MonitorTarget[]) => update({ monitors: m })}
            onClear={monitors.clear}
            onSilence={monitors.silence}
          />
        );
      case "diag":
        return <DiagTool samples={monitors.samples} />;
      case "topology":
        return (
          <TopologyTool
            terminals={terminals}
            sessions={sessions}
            topo={settings.topology}
            snapshots={settings.topoSnapshots}
            onTopo={(t) => update((s) => ({ topology: typeof t === "function" ? t(s.topology) : t }))}
            onSnapshots={(topoSnapshots) => update({ topoSnapshots })}
            onOpenSession={onOpenSession}
          />
        );
      case "subnet":
        return <SubnetTool />;
      case "perf":
        return (
          <PerfTool
            history={settings.speedHistory}
            onResult={(r: SpeedResult) => update((s) => ({ speedHistory: [r, ...s.speedHistory].slice(0, 20) }))}
            onHistory={(speedHistory: SpeedResult[]) => update({ speedHistory })}
          />
        );
      case "transfer":
        return (
          <TransferTool
            settings={settings}
            running={running}
            onChange={update}
            refreshRunning={refreshRunning}
            terminals={terminals}
            onConfirm={onConfirm}
            onScp={onScp}
          />
        );
      case "syslog":
        return <SyslogTool settings={settings} running={running} onChange={update} refreshRunning={refreshRunning} />;
      case "plugins":
        return <PluginsTool connId={connId} onConfirm={onConfirm} />;
    }
  };

  return (
    <div className="absolute inset-0 flex bg-bg" style={{ visibility: active ? "visible" : "hidden" }}>
      <nav className="w-44 shrink-0 border-r border-line bg-chrome p-2 space-y-0.5">
        {enabled.map(({ id, label, Icon }) => (
          <button
            key={id}
            onClick={() => go(id)}
            className={`w-full flex items-center gap-2 px-2 h-8 rounded-md text-left ${
              current === id ? "bg-selected text-fg" : "text-muted hover:text-fg hover:bg-hover"
            }`}
          >
            <Icon size={15} />
            {label}
            {(id === "transfer" && (running.includes("tftp") || running.includes("http"))) ||
            (id === "syslog" && running.includes("syslog")) ? (
              <span className="ml-auto w-1.5 h-1.5 rounded-full bg-ok" title="Servidor activo" />
            ) : null}
          </button>
        ))}
        {enabled.length === 0 && <p className="p-2 text-[12px] text-muted">Activa módulos en Ajustes › Módulos.</p>}
      </nav>
      <div className="flex-1 min-w-0 overflow-y-auto">
        <div className="max-w-[1200px] mx-auto p-5">
          {enabled
            .filter((n) => visited.has(n.id))
            .map((n) => (
              <div key={n.id} hidden={n.id !== current}>
                {pane(n.id)}
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}
