import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { Download, FileCode2, Network, Radar, Trash2, ZoomIn, ZoomOut } from "lucide-react";
import { runOnDevice } from "../../lib/deviceRun";
import {
  NEIGHBOR_COMMANDS,
  TopoNode,
  Topology,
  layout,
  mergeNeighbors,
  nodeId,
  parseNeighbors,
  promptName,
  toCsv,
  toMermaid,
} from "../../lib/topology";
import { vendorFor } from "../../lib/commands";
import type { Session } from "../../types";
import type { TerminalRef } from "./FileManager";
import { Btn, Label, Section } from "./ui";

const STORE = "topology";
const W = 170;
const H = 54;

function loadTopo(): Topology {
  try {
    return JSON.parse(localStorage.getItem(STORE) ?? "") as Topology;
  } catch {
    return { nodes: [], links: [] };
  }
}

/** Punto de una etiqueta de puerto: cerca del extremo del enlace. */
const near = (ax: number, ay: number, bx: number, by: number, t = 0.22) => ({ x: ax + (bx - ax) * t, y: ay + (by - ay) * t });

/** SVG autónomo (colores fijos claros) para documentación. */
function toSvg(t: Topology): string {
  if (!t.nodes.length) return "";
  const xs = t.nodes.map((n) => n.x);
  const ys = t.nodes.map((n) => n.y);
  const minX = Math.min(...xs) - W / 2 - 40;
  const minY = Math.min(...ys) - H / 2 - 40;
  const w = Math.max(...xs) - minX + W / 2 + 40;
  const h = Math.max(...ys) - minY + H / 2 + 40;
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
  const node = (id: string) => t.nodes.find((n) => n.id === id)!;
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX} ${minY} ${w} ${h}" width="${w}" height="${h}" font-family="Helvetica, Arial, sans-serif">`,
    `<rect x="${minX}" y="${minY}" width="${w}" height="${h}" fill="#ffffff"/>`,
  ];
  for (const l of t.links) {
    const a = node(l.a);
    const b = node(l.b);
    if (!a || !b) continue;
    const pa = near(a.x, a.y, b.x, b.y);
    const pb = near(b.x, b.y, a.x, a.y);
    parts.push(`<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="#8a919c" stroke-width="2"/>`);
    parts.push(`<text x="${pa.x}" y="${pa.y}" font-size="11" fill="#1f2328" text-anchor="middle" paint-order="stroke" stroke="#fff" stroke-width="4">${esc(l.aPort)}</text>`);
    parts.push(`<text x="${pb.x}" y="${pb.y}" font-size="11" fill="#1f2328" text-anchor="middle" paint-order="stroke" stroke="#fff" stroke-width="4">${esc(l.bPort)}</text>`);
  }
  for (const n of t.nodes) {
    parts.push(
      `<rect x="${n.x - W / 2}" y="${n.y - H / 2}" width="${W}" height="${H}" rx="10" fill="${n.explored ? "#eaf1ff" : "#f4f5f7"}" stroke="${n.explored ? "#2563eb" : "#c3c8d0"}" stroke-width="1.5"/>`,
      `<text x="${n.x}" y="${n.y - 4}" font-size="13" font-weight="600" fill="#1f2328" text-anchor="middle">${esc(n.name)}</text>`,
    );
    if (n.ip) parts.push(`<text x="${n.x}" y="${n.y + 14}" font-size="11" fill="#6a7280" text-anchor="middle">${esc(n.ip)}</text>`);
  }
  parts.push("</svg>");
  return parts.join("\n");
}

export function TopologyTool({
  terminals,
  onOpenSession,
}: {
  terminals: TerminalRef[];
  onOpenSession: (s: Session) => void;
}) {
  const [topo, setTopo] = useState<Topology>(loadTopo);
  const [connId, setConnId] = useState("");
  const term = terminals.find((t) => t.connId === connId);
  const [vendor, setVendor] = useState("cisco");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const drag = useRef<{ id: string; sx: number; sy: number; x: number; y: number } | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(STORE, JSON.stringify(topo));
    } catch {
      /* sin almacenamiento */
    }
  }, [topo]);

  // Por defecto la sesión más reciente (la que se acaba de abrir al seguir la ruta).
  useEffect(() => {
    if (!term && terminals.length) setConnId(terminals[terminals.length - 1].connId);
  }, [terminals, term]);
  useEffect(() => {
    if (term) setVendor(vendorFor(term.highlight) === "fortinet" ? "cisco" : vendorFor(term.highlight));
  }, [term]);

  const discover = async () => {
    if (!term) return;
    setBusy(true);
    setMsg("");
    try {
      const outputs: string[] = [];
      for (const cmd of NEIGHBOR_COMMANDS[vendor]) outputs.push(await runOnDevice(term.connId, cmd, 60));
      const neighbors = parseNeighbors(vendor, outputs);
      const name = promptName(outputs[outputs.length - 1]) ?? term.name;
      setTopo((t) => mergeNeighbors(t, { name, ip: term.host }, neighbors));
      setSelected(nodeId(name));
      setMsg(
        neighbors.length
          ? `${name}: ${neighbors.length} vecinos encontrados`
          : `${name}: sin vecinos. Verifica que CDP/LLDP esté habilitado (lldp run / lldp enable).`,
      );
    } catch (e) {
      setMsg(String(e));
    }
    setBusy(false);
  };

  const node = (id: string) => topo.nodes.find((n) => n.id === id);
  const sel = selected ? node(selected) : undefined;

  const box = useMemo(() => {
    if (!topo.nodes.length) return { x: 0, y: 0, w: 800, h: 400 };
    const xs = topo.nodes.map((n) => n.x);
    const ys = topo.nodes.map((n) => n.y);
    const pad = 30;
    const x = Math.min(...xs) - W / 2 - pad;
    const y = Math.min(...ys) - H / 2 - pad;
    return { x, y, w: Math.max(...xs) - x + W / 2 + pad, h: Math.max(...ys) - y + H / 2 + pad };
  }, [topo.nodes]);

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d) return;
    const svg = e.currentTarget.getBoundingClientRect();
    // El SVG se ajusta al contenedor manteniendo proporción: manda el eje más ajustado.
    const scale = Math.max(box.w / svg.width, box.h / svg.height);
    const x = d.x + (e.clientX - d.sx) * scale;
    const y = d.y + (e.clientY - d.sy) * scale;
    setTopo((t) => ({ ...t, nodes: t.nodes.map((n) => (n.id === d.id ? { ...n, x, y } : n)) }));
  };

  const exportFile = async (ext: "svg" | "csv", content: string) => {
    const dest = await save({ defaultPath: `topologia.${ext}`, filters: [{ name: ext.toUpperCase(), extensions: [ext] }] });
    if (!dest) return;
    await invoke("save_text", { dest, content }).then(() => setMsg(`Guardado: ${dest}`)).catch((e) => setMsg(String(e)));
  };

  const follow = (n: TopoNode) => {
    if (!term || !n.ip) return;
    const base = term.session;
    onOpenSession({
      ...base,
      id: "",
      name: n.name,
      type: "ssh",
      host: n.ip,
      port: base.type === "ssh" ? base.port : 22,
      platform: undefined,
      on_connect: base.on_connect,
      scp: undefined,
      created_at: new Date().toISOString(),
    });
    setMsg(`Abriendo sesión a ${n.name}: autentícate en su pestaña, vuelve aquí y pulsa "Descubrir vecinos".`);
  };

  return (
    <div className="space-y-4">
      <Section
        title="Topología CDP / LLDP"
        hint="Descubre los vecinos del equipo conectado y sigue la ruta salto a salto: clic en un vecino y 'Conectar'. Solo usa comandos de consulta."
      >
        <div className="flex flex-wrap items-end gap-2">
          <Label text="Equipo (sesión conectada)" className="flex-1 min-w-48">
            <select className="field" value={connId} onChange={(e) => setConnId(e.target.value)}>
              {!terminals.length && <option value="">Sin sesiones conectadas</option>}
              {terminals.map((t) => (
                <option key={t.connId} value={t.connId}>
                  {t.name}
                  {t.host ? ` · ${t.host}` : ""}
                </option>
              ))}
            </select>
          </Label>
          <Label text="Fabricante" className="w-36">
            <select className="field" value={vendor} onChange={(e) => setVendor(e.target.value)}>
              <option value="cisco">Cisco (CDP + LLDP)</option>
              <option value="huawei">Huawei (LLDP)</option>
              <option value="juniper">Juniper (LLDP)</option>
            </select>
          </Label>
          <Btn kind="primary" disabled={!term || busy} onClick={discover}>
            <Radar size={14} className={busy ? "animate-pulse" : ""} /> {busy ? "Leyendo…" : "Descubrir vecinos"}
          </Btn>
          <div className="flex gap-1 ml-auto">
            <Btn kind="ghost" title="Acercar" onClick={() => setZoom((z) => Math.min(2.5, z + 0.2))}>
              <ZoomIn size={14} />
            </Btn>
            <Btn kind="ghost" title="Alejar" onClick={() => setZoom((z) => Math.max(0.4, z - 0.2))}>
              <ZoomOut size={14} />
            </Btn>
            <Btn kind="ghost" title="Reordenar automáticamente" onClick={() => setTopo((t) => layout({ ...t, nodes: t.nodes.map((n) => ({ ...n, x: 0, y: 0 })) }))}>
              <Network size={14} />
            </Btn>
            <Btn kind="ghost" title="Exportar SVG" disabled={!topo.nodes.length} onClick={() => exportFile("svg", toSvg(topo))}>
              <Download size={14} /> SVG
            </Btn>
            <Btn kind="ghost" title="Exportar tabla de enlaces" disabled={!topo.links.length} onClick={() => exportFile("csv", toCsv(topo))}>
              CSV
            </Btn>
            <Btn
              kind="ghost"
              title="Copiar como Mermaid (Confluence, GitLab, GitHub)"
              disabled={!topo.nodes.length}
              onClick={() => writeText(toMermaid(topo)).then(() => setMsg("Diagrama Mermaid copiado al portapapeles"))}
            >
              <FileCode2 size={14} /> Mermaid
            </Btn>
            <Btn
              kind="ghost"
              className="hover:!text-danger"
              title="Borrar diagrama"
              disabled={!topo.nodes.length}
              onClick={() => {
                setTopo({ nodes: [], links: [] });
                setSelected(null);
              }}
            >
              <Trash2 size={14} />
            </Btn>
          </div>
        </div>
        {msg && <p className="mt-2 text-[12px] text-accent">{msg}</p>}
      </Section>

      <div className="grid gap-4 [grid-template-columns:1fr_260px]">
        <div className="rounded-xl border border-line bg-panel overflow-auto" style={{ height: 520 }}>
          {!topo.nodes.length ? (
            <div className="h-full grid place-items-center text-[12.5px] text-muted p-6 text-center">
              Conecta una sesión con un equipo y pulsa "Descubrir vecinos" para empezar el diagrama.
            </div>
          ) : (
            <svg
              viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`}
              style={{ width: `${zoom * 100}%`, height: `${zoom * 100}%` }}
              onPointerMove={onPointerMove}
              onPointerUp={() => (drag.current = null)}
              onPointerLeave={() => (drag.current = null)}
            >
              {topo.links.map((l, i) => {
                const a = node(l.a);
                const b = node(l.b);
                if (!a || !b) return null;
                const pa = near(a.x, a.y, b.x, b.y);
                const pb = near(b.x, b.y, a.x, a.y);
                const hot = selected === l.a || selected === l.b;
                return (
                  <g key={i}>
                    <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={hot ? "var(--accent)" : "var(--muted)"} strokeWidth={hot ? 2.5 : 1.5} />
                    {[
                      [pa, l.aPort],
                      [pb, l.bPort],
                    ].map(([pt, label], k) => (
                      <text
                        key={k}
                        x={(pt as { x: number }).x}
                        y={(pt as { y: number }).y}
                        fontSize={11}
                        textAnchor="middle"
                        fill="var(--text)"
                        stroke="var(--panel)"
                        strokeWidth={4}
                        paintOrder="stroke"
                      >
                        {label as string}
                      </text>
                    ))}
                  </g>
                );
              })}
              {topo.nodes.map((n) => (
                <g
                  key={n.id}
                  style={{ cursor: "grab" }}
                  onPointerDown={(e) => {
                    (e.currentTarget.ownerSVGElement as SVGSVGElement).setPointerCapture(e.pointerId);
                    drag.current = { id: n.id, sx: e.clientX, sy: e.clientY, x: n.x, y: n.y };
                    setSelected(n.id);
                  }}
                >
                  {/* Fondo opaco: el relleno de los explorados es translúcido y dejaba ver los enlaces. */}
                  <rect x={n.x - W / 2} y={n.y - H / 2} width={W} height={H} rx={10} fill="var(--panel)" />
                  <rect
                    x={n.x - W / 2}
                    y={n.y - H / 2}
                    width={W}
                    height={H}
                    rx={10}
                    fill={n.explored ? "var(--selected)" : "var(--chrome)"}
                    stroke={selected === n.id ? "var(--accent)" : n.explored ? "var(--accent)" : "var(--border)"}
                    strokeWidth={selected === n.id ? 2.5 : 1.5}
                  />
                  <text x={n.x} y={n.y - 4} fontSize={13} fontWeight={600} textAnchor="middle" fill="var(--text)">
                    {n.name.length > 22 ? `${n.name.slice(0, 21)}…` : n.name}
                  </text>
                  <text x={n.x} y={n.y + 14} fontSize={11} textAnchor="middle" fill="var(--muted)">
                    {n.ip ?? (n.explored ? "explorado" : "sin IP de gestión")}
                  </text>
                </g>
              ))}
            </svg>
          )}
        </div>

        <Section title={sel ? sel.name : "Detalle"} hint={sel ? (sel.explored ? "Vecinos ya leídos" : "Aún no explorado") : "Selecciona un equipo"}>
          {sel && (
            <div className="space-y-2 text-[12px]">
              {sel.ip && (
                <p>
                  <span className="text-muted">Gestión:</span> <span className="font-mono">{sel.ip}</span>
                </p>
              )}
              {sel.platform && (
                <p className="text-muted leading-snug" title={sel.platform}>
                  {sel.platform.length > 120 ? `${sel.platform.slice(0, 119)}…` : sel.platform}
                </p>
              )}
              <div className="space-y-1">
                {topo.links
                  .filter((l) => l.a === sel.id || l.b === sel.id)
                  .map((l, i) => {
                    const mine = l.a === sel.id;
                    const other = node(mine ? l.b : l.a);
                    return (
                      <button
                        key={i}
                        onClick={() => setSelected(other?.id ?? null)}
                        className="w-full text-left px-2 py-1 rounded-md hover:bg-hover font-mono text-[11.5px]"
                      >
                        {mine ? l.aPort : l.bPort} → {other?.name} {mine ? l.bPort : l.aPort}
                      </button>
                    );
                  })}
              </div>
              {!sel.explored && (
                <Btn kind="primary" className="w-full" disabled={!sel.ip || !term} onClick={() => follow(sel)} title={sel.ip ? `SSH a ${sel.ip}` : "El vecino no informó IP de gestión"}>
                  Conectar y seguir la ruta
                </Btn>
              )}
              {sel.ip && (
                <Btn className="w-full" onClick={() => writeText(sel.ip!)}>
                  Copiar IP
                </Btn>
              )}
            </div>
          )}
        </Section>
      </div>
    </div>
  );
}
