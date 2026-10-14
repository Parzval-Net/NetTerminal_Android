import { useMemo, useState } from "react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  ChevronRight,
  Copy,
  CornerDownLeft,
  ExternalLink,
  Package,
  Pencil,
  Play,
  Plus,
  Radar,
  Search,
  Star,
  TextCursorInput,
  X,
} from "lucide-react";
import { CATEGORIES, CatalogEntry, CatalogVendor, Risk, appliesTo, commandFor, riskLabel } from "../lib/packs";
import { modLabel } from "../lib/platform";

interface Props {
  width: number;
  catalog: CatalogVendor[];
  vendor: string;
  onVendor: (v: string) => void;
  /** Plataforma de la sesión activa para este fabricante (detectada o elegida). */
  platform: string | null;
  onPlatform: (p: string | null) => void;
  onDetect: (() => void) | null;
  detecting: boolean;
  favorites: string[];
  onFavorites: (f: string[]) => void;
  target: string | null;
  onRun: (c: CatalogEntry, cmd: string) => void;
  onType: (cmd: string) => void;
  onAdd: (vendor: string) => void;
  onEdit: (c: CatalogEntry) => void;
  onPacks: () => void;
  onClose: () => void;
}

const riskStyle: Record<Risk, string> = { read: "text-ok", change: "text-warn", disruptive: "text-danger" };
const riskIcon: Record<Risk, string> = { read: "●", change: "▲", disruptive: "✕" };

function CmdText({ cmd }: { cmd: string }) {
  const parts = cmd.split(/(\{\{[^}]+\}\})/);
  return (
    <code className="block font-mono text-[12px] whitespace-pre-wrap break-all">
      {parts.map((p, i) =>
        p.startsWith("{{") ? (
          <span key={i} className="text-accent font-semibold">
            {p}
          </span>
        ) : (
          p
        ),
      )}
    </code>
  );
}

export function CommandsPanel(p: Props) {
  const [query, setQuery] = useState("");
  const [onlyRead, setOnlyRead] = useState(false);
  const [onlyFav, setOnlyFav] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>({ Sistema: true });
  const [copied, setCopied] = useState<string | null>(null);
  const vendor = p.catalog.find((v) => v.id === p.vendor) ?? p.catalog[0];
  const platform = vendor?.platforms.some((x) => x.id === p.platform) ? p.platform : null;
  const favKey = (c: CatalogEntry) => `${vendor?.id}:${c.cmd}`;

  const groups = useMemo(() => {
    if (!vendor) return [];
    const q = query.trim().toLowerCase();
    const list = vendor.commands.filter(
      (c) =>
        appliesTo(c, platform) &&
        (!q || c.cmd.toLowerCase().includes(q) || c.desc.toLowerCase().includes(q) || c.note?.toLowerCase().includes(q)) &&
        (!onlyRead || c.risk === "read") &&
        (!onlyFav || p.favorites.includes(`${vendor.id}:${c.cmd}`)),
    );
    return CATEGORIES.map((cat) => [cat, list.filter((c) => c.cat === cat)] as const).filter(([, l]) => l.length);
  }, [vendor, platform, query, onlyRead, onlyFav, p.favorites]);

  const filtering = !!query.trim() || onlyFav;
  const total = groups.reduce((n, [, l]) => n + l.length, 0);
  const platLabel = (id: string) => vendor?.platforms.find((x) => x.id === id)?.label ?? id;

  return (
    <aside className="relative shrink-0 flex flex-col border-l border-line bg-chrome" style={{ width: p.width }}>
      <header className="flex items-center gap-1 px-2 h-9 border-b border-line">
        <div className="flex flex-1 min-w-0 p-0.5 rounded-lg bg-hover overflow-x-auto [scrollbar-width:none]">
          {p.catalog.map((v) => (
            <button
              key={v.id}
              onClick={() => p.onVendor(v.id)}
              className={`flex-1 shrink-0 px-2 h-6 rounded-md text-[11.5px] whitespace-nowrap ${
                vendor?.id === v.id ? "bg-panel shadow-sm text-fg" : "text-muted hover:text-fg"
              }`}
            >
              {v.name}
            </button>
          ))}
        </div>
        <HeadBtn title="Packs de comandos" onClick={p.onPacks}>
          <Package size={14} />
        </HeadBtn>
        <HeadBtn title={`Cerrar (${modLabel}L)`} onClick={p.onClose}>
          <X size={15} />
        </HeadBtn>
      </header>

      <div className="px-2 pt-2 space-y-1.5">
        {vendor && vendor.platforms.length > 0 && (
          <div className="flex gap-1.5">
            <select
              className="field !h-7 !text-[12px] flex-1 min-w-0"
              value={platform ?? ""}
              onChange={(e) => p.onPlatform(e.target.value || null)}
              title="La sintaxis y los comandos se ajustan a la plataforma"
            >
              <option value="">Todas las plataformas</option>
              {vendor.platforms.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.label}
                </option>
              ))}
            </select>
            {p.onDetect && (
              <button
                onClick={p.onDetect}
                disabled={p.detecting}
                title={`Detectar ejecutando "${vendor.detectCommand}" en la sesión`}
                className="flex items-center gap-1 px-2 h-7 rounded-md border border-line text-[11.5px] hover:bg-hover disabled:opacity-40"
              >
                <Radar size={12} className={p.detecting ? "animate-pulse" : ""} /> Detectar
              </button>
            )}
          </div>
        )}
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
          <input
            className="field !h-7 !pl-8 !text-[12px]"
            placeholder="Buscar comando o tarea (ej: vecinos, óptico, CPU)"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setQuery("")}
          />
        </div>
        <div className="flex items-center gap-3 text-[11.5px] text-muted">
          <label className="flex items-center gap-1.5">
            <input type="checkbox" className="accent-[var(--accent)]" checked={onlyRead} onChange={(e) => setOnlyRead(e.target.checked)} />
            Solo consultas
          </label>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" className="accent-[var(--accent)]" checked={onlyFav} onChange={(e) => setOnlyFav(e.target.checked)} />
            Favoritos
          </label>
          <span className="ml-auto">{total}</span>
          {vendor && (
            <button title="Agregar un comando propio" onClick={() => p.onAdd(vendor.id)} className="text-accent hover:underline flex items-center gap-0.5">
              <Plus size={12} /> Propio
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-2 space-y-1">
        {groups.map(([cat, list]) => {
          const isOpen = filtering || open[cat];
          return (
            <div key={cat}>
              <button
                onClick={() => setOpen((o) => ({ ...o, [cat]: !o[cat] }))}
                className="w-full flex items-center gap-1 px-1 h-7 text-[11px] font-semibold uppercase tracking-wide text-muted hover:text-fg"
              >
                <ChevronRight size={12} className={`transition-transform ${isOpen ? "rotate-90" : ""}`} />
                {cat}
                <span className="ml-auto font-normal">{list.length}</span>
              </button>
              {isOpen &&
                list.map((c) => {
                  const cmd = commandFor(c, platform);
                  const fav = p.favorites.includes(favKey(c));
                  return (
                    <div key={c.cmd} className="group rounded-lg px-2 py-1.5 hover:bg-hover">
                      <div className="flex items-start gap-2">
                        <div className="min-w-0 flex-1">
                          <CmdText cmd={cmd} />
                          <p className="text-[11.5px] text-muted mt-0.5 leading-snug">{c.desc}</p>
                          {!platform && c.variants?.length ? (
                            <div className="mt-1 space-y-0.5">
                              {c.variants.map((v) => (
                                <div key={v.cmd} className="text-[11px] text-muted">
                                  <span className="font-medium">{v.platforms.map(platLabel).join(", ")}:</span>{" "}
                                  <code className="font-mono">{v.cmd}</code>
                                </div>
                              ))}
                            </div>
                          ) : null}
                          {c.note && <p className="text-[11px] text-muted mt-0.5 italic leading-snug">{c.note}</p>}
                          <div className="flex flex-wrap items-center gap-x-2 mt-0.5 text-[10.5px]">
                            <span className={riskStyle[c.risk]} title={c.escalated ? `El pack lo declaró "${riskLabel[c.declaredRisk]}"; la app lo subió por seguridad` : undefined}>
                              {riskIcon[c.risk]} {riskLabel[c.risk]}
                              {c.escalated ? " (ajustado)" : ""}
                            </span>
                            {c.platforms?.length ? <span className="text-muted">{c.platforms.map(platLabel).join(", ")}</span> : null}
                            {!c.builtin && <span className="text-accent">{c.packName}</span>}
                          </div>
                        </div>
                        <button
                          title={fav ? "Quitar de favoritos" : "Agregar a favoritos"}
                          onClick={() => p.onFavorites(fav ? p.favorites.filter((f) => f !== favKey(c)) : [...p.favorites, favKey(c)])}
                          className={`shrink-0 mt-0.5 ${fav ? "text-warn" : "text-muted opacity-0 group-hover:opacity-100"}`}
                        >
                          <Star size={13} fill={fav ? "currentColor" : "none"} />
                        </button>
                      </div>
                      <div className="hidden group-hover:flex flex-wrap gap-1 mt-1.5">
                        <PanelBtn disabled={!p.target} onClick={() => p.onRun(c, cmd)} title={p.target ? `Ejecutar en ${p.target}` : "Conecta una sesión"}>
                          <Play size={11} /> Ejecutar
                        </PanelBtn>
                        {!cmd.includes("\n") && (
                          <PanelBtn disabled={!p.target} onClick={() => p.onType(cmd)} title="Escribir en la terminal sin Enter">
                            <TextCursorInput size={11} /> Escribir
                          </PanelBtn>
                        )}
                        <PanelBtn
                          onClick={async () => {
                            await writeText(cmd);
                            setCopied(c.cmd);
                            window.setTimeout(() => setCopied(null), 1500);
                          }}
                        >
                          {copied === c.cmd ? <CornerDownLeft size={11} /> : <Copy size={11} />} {copied === c.cmd ? "Copiado" : "Copiar"}
                        </PanelBtn>
                        {c.source && (
                          <PanelBtn onClick={() => openUrl(c.source!)} title={c.source}>
                            <ExternalLink size={11} /> Fuente
                          </PanelBtn>
                        )}
                        {c.packId.startsWith("user-") && (
                          <PanelBtn onClick={() => p.onEdit(c)}>
                            <Pencil size={11} /> Editar
                          </PanelBtn>
                        )}
                      </div>
                    </div>
                  );
                })}
            </div>
          );
        })}
        {total === 0 && <p className="p-4 text-center text-[12px] text-muted">Sin resultados</p>}
      </div>

      <footer className="px-3 py-1.5 border-t border-line text-[11px] text-muted">
        {p.target ? `Destino: ${p.target}` : "Sin sesión conectada"}
        {platform ? ` · ${platLabel(platform)}` : ""} · verifica la sintaxis en tu versión
      </footer>
    </aside>
  );
}

function HeadBtn(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...props} className="w-7 h-7 shrink-0 grid place-items-center rounded-md text-muted hover:text-fg hover:bg-hover" />;
}

function PanelBtn(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className="inline-flex items-center gap-1 px-2 h-6 rounded-md border border-line bg-panel text-[11.5px] hover:bg-hover disabled:opacity-40"
    />
  );
}
