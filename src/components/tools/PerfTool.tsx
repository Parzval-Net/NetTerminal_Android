import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Gauge, Play, Square } from "lucide-react";
import { SpeedResult } from "../../lib/settings";
import { LineChart, StatTile } from "./LineChart";
import { Btn, Console, CopyText, Label, Section, Toggle } from "./ui";
import { useJob } from "./useJob";

interface IperfResult {
  protocol: string;
  sent_mbps: number | null;
  received_mbps: number | null;
  retransmits: number | null;
  jitter_ms: number | null;
  lost_percent: number | null;
  cpu_local: number | null;
  cpu_remote: number | null;
  remote: string | null;
  intervals: number[];
}

const mbps = (v: number | null | undefined) =>
  v == null ? "—" : v >= 1000 ? `${(v / 1000).toFixed(2)} Gbps` : `${v.toFixed(v >= 100 ? 0 : 1)} Mbps`;

export function PerfTool({ history, onResult }: { history: SpeedResult[]; onResult: (r: SpeedResult) => void }) {
  return (
    <div className="space-y-4">
      <SpeedTest history={history} onResult={onResult} />
      <Iperf />
    </div>
  );
}

function SpeedTest({ history, onResult }: { history: SpeedResult[]; onResult: (r: SpeedResult) => void }) {
  const job = useJob<SpeedResult, { phase: string; value: number; progress: number }>();
  const [live, setLive] = useState<{ download: number[]; upload: number[] }>({ download: [], upload: [] });

  useEffect(() => {
    const p = job.progress;
    if (p && (p.phase === "download" || p.phase === "upload"))
      setLive((l) => ({ ...l, [p.phase]: [...l[p.phase as "download" | "upload"], p.value] }));
  }, [job.progress]);

  useEffect(() => {
    if (job.result) onResult(job.result);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job.result]);

  const r = job.result ?? history[0];
  const phaseLabel = { latency: "Midiendo latencia", download: "Midiendo bajada", upload: "Midiendo subida" }[job.progress?.phase ?? ""] ?? "Preparando";

  return (
    <Section
      title="Speedtest"
      hint="Contra speed.cloudflare.com (red anycast más cercana). Consume ~95 MB de datos por prueba."
      right={
        <Btn
          kind={job.running ? "default" : "primary"}
          onClick={() => {
            if (job.running) return job.stop();
            setLive({ download: [], upload: [] });
            job.start("tool_speedtest");
          }}
        >
          {job.running ? <Square size={13} /> : <Gauge size={14} />} {job.running ? "Cancelar" : "Iniciar prueba"}
        </Btn>
      }
    >
      {job.running && (
        <div className="mb-3">
          <div className="flex justify-between text-[11.5px] text-muted mb-1">
            <span>{phaseLabel}</span>
            <span>{job.progress ? `${Math.round(job.progress.progress * 100)} %` : ""}</span>
          </div>
          <div className="h-1.5 rounded-full bg-hover overflow-hidden">
            <div className="h-full bg-accent transition-all" style={{ width: `${(job.progress?.progress ?? 0) * 100}%` }} />
          </div>
        </div>
      )}
      {job.error && <p className="mb-2 text-[12px] text-danger">{job.error}</p>}
      <div className="grid grid-cols-4 gap-2">
        <StatTile label="Bajada" value={mbps(r?.download_mbps)} />
        <StatTile label="Subida" value={mbps(r?.upload_mbps)} />
        <StatTile label="Latencia" value={r ? `${r.latency_ms.toFixed(1)} ms` : "—"} />
        <StatTile label="Jitter" value={r ? `${r.jitter_ms.toFixed(1)} ms` : "—"} />
      </div>
      {r?.server?.colo && (
        <p className="mt-2 text-[11.5px] text-muted">
          Servidor: {r.server.colo}
          {r.server.city ? ` (${r.server.city})` : ""} · {new Date(r.ts).toLocaleString("es-CL")}
        </p>
      )}
      {job.running && live.download.length > 0 && (
        <div className="mt-3">
          <LineChart title="Mediciones de bajada" unit="Mbps" height={110} points={live.download.map((y, i) => ({ x: i, y }))} />
        </div>
      )}
      {history.length > 1 && (
        <details className="mt-3">
          <summary className="text-[12px] text-muted cursor-default">Historial ({history.length})</summary>
          <table className="w-full mt-2 text-[12px]">
            <thead className="text-muted text-left">
              <tr>
                <th className="font-medium py-1">Fecha</th>
                <th className="font-medium">Bajada</th>
                <th className="font-medium">Subida</th>
                <th className="font-medium">Latencia</th>
                <th className="font-medium">Servidor</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {history.map((h) => (
                <tr key={h.ts} className="border-t border-line">
                  <td className="py-1">{new Date(h.ts).toLocaleString("es-CL")}</td>
                  <td>{mbps(h.download_mbps)}</td>
                  <td>{mbps(h.upload_mbps)}</td>
                  <td>{h.latency_ms.toFixed(1)} ms</td>
                  <td>{h.server?.colo ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </Section>
  );
}

function Iperf() {
  const [version, setVersion] = useState<string | null | undefined>(undefined);
  const [host, setHost] = useState("");
  const [port, setPort] = useState(5201);
  const [seconds, setSeconds] = useState(10);
  const [parallel, setParallel] = useState(1);
  const [reverse, setReverse] = useState(false);
  const [udp, setUdp] = useState(false);
  const [bandwidth, setBandwidth] = useState("100M");
  const client = useJob<IperfResult>();
  const server = useJob();
  const [ips, setIps] = useState<{ name: string; ip: string }[]>([]);

  useEffect(() => {
    invoke<string | null>("tool_iperf_version").then(setVersion);
    invoke<{ name: string; ip: string }[]>("local_ips").then(setIps);
  }, []);

  if (version === null)
    return (
      <Section title="iperf3" hint="Throughput, retransmisiones, jitter y pérdida entre dos puntos.">
        <p className="text-[12.5px]">
          iperf3 no está instalado en este equipo. Instálalo y vuelve a abrir esta sección:
        </p>
        <ul className="mt-2 space-y-1 text-[12px] text-muted">
          <li>
            macOS: <CopyText text="brew install iperf3" />
          </li>
          <li>
            Linux: <CopyText text="sudo apt install iperf3" />
          </li>
          <li>Windows: binario oficial en iperf.fr; deja iperf3.exe en el PATH o junto a NetTerminal.exe</li>
        </ul>
      </Section>
    );

  const r = client.result;

  return (
    <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(400px,1fr))]">
      <Section title="iperf3 · cliente" hint={version ?? "Detectando…"}>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (client.running) return client.stop();
            client.start("tool_iperf", {
              params: { host: host.trim(), port, seconds, parallel, reverse, udp, bandwidth: udp ? bandwidth : undefined },
            });
          }}
        >
          <div className="grid grid-cols-[1fr_90px_90px_80px] gap-2">
            <Label text="Servidor iperf3">
              <input className="field" value={host} placeholder="10.0.0.2" onChange={(e) => setHost(e.target.value)} />
            </Label>
            <Label text="Puerto">
              <input className="field" type="number" value={port} onChange={(e) => setPort(Number(e.target.value) || 5201)} />
            </Label>
            <Label text="Duración">
              <select className="field" value={seconds} onChange={(e) => setSeconds(Number(e.target.value))}>
                {[5, 10, 30, 60].map((s) => (
                  <option key={s} value={s}>
                    {s} s
                  </option>
                ))}
              </select>
            </Label>
            <Label text="Flujos">
              <select className="field" value={parallel} onChange={(e) => setParallel(Number(e.target.value))}>
                {[1, 2, 4, 8, 16].map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </Label>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <Toggle checked={reverse} onChange={setReverse} label="Inverso (servidor → cliente)" />
            <Toggle checked={udp} onChange={setUdp} label="UDP" />
            {udp && (
              <input className="field !w-24 !h-7" value={bandwidth} title="Ancho de banda objetivo (ej. 100M, 1G)" onChange={(e) => setBandwidth(e.target.value)} />
            )}
            <Btn type="submit" kind={client.running ? "default" : "primary"} className="ml-auto" disabled={!host.trim()}>
              {client.running ? <Square size={13} /> : <Play size={13} />} {client.running ? `Midiendo ${seconds} s…` : "Medir"}
            </Btn>
          </div>
        </form>
        {client.error && <p className="mt-2 text-[12px] text-danger">{client.error}</p>}
        {r && (
          <div className="mt-3 space-y-3">
            <div className="grid grid-cols-4 gap-2">
              <StatTile label="Enviado" value={mbps(r.sent_mbps)} />
              <StatTile label="Recibido" value={mbps(r.received_mbps)} />
              {r.protocol === "UDP" ? (
                <>
                  <StatTile label="Jitter" value={r.jitter_ms != null ? `${r.jitter_ms.toFixed(2)} ms` : "—"} />
                  <StatTile label="Pérdida" value={r.lost_percent != null ? `${r.lost_percent.toFixed(2)} %` : "—"} tone={(r.lost_percent ?? 0) > 1 ? "danger" : undefined} />
                </>
              ) : (
                <>
                  <StatTile label="Retransmisiones" value={String(r.retransmits ?? "—")} tone={(r.retransmits ?? 0) > 0 ? "warn" : undefined} />
                  <StatTile label="CPU local / remota" value={r.cpu_local != null ? `${r.cpu_local.toFixed(0)} / ${(r.cpu_remote ?? 0).toFixed(0)} %` : "—"} />
                </>
              )}
            </div>
            {r.intervals.length > 1 && (
              <LineChart title="Throughput por segundo" unit="Mbps" height={130} points={r.intervals.map((y, i) => ({ x: i + 1, y }))} xLabel={(x) => `Segundo ${x}`} />
            )}
          </div>
        )}
        {!r && client.lines.length > 0 && <Console lines={client.lines} height={120} />}
      </Section>

      <Section
        title="iperf3 · servidor"
        hint="Para medir desde otro equipo hacia este PC."
        right={
          <Btn kind={server.running ? "default" : "primary"} onClick={() => (server.running ? server.stop() : server.start("tool_iperf", { params: { server: true, port } }))}>
            {server.running ? "Detener" : "Iniciar"}
          </Btn>
        }
      >
        <p className="text-[12px] text-muted mb-2">Desde el otro extremo ejecuta:</p>
        <div className="flex flex-wrap gap-1.5 mb-3">
          {ips.map((i) => (
            <CopyText key={i.ip} text={`iperf3 -c ${i.ip} -p ${port}`} />
          ))}
        </div>
        <Console lines={server.lines} empty={server.running ? "Esperando clientes…" : "Detenido"} height={160} />
      </Section>
    </div>
  );
}
