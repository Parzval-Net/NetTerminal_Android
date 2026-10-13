/**
 * Carpetas jerárquicas. Cada sesión guarda su ruta en `folder` ("Clientes/Acme/Core").
 * Las carpetas vacías se guardan aparte (ajustes) para que no desaparezcan.
 */
import type { Session } from "../types";

export interface FolderNode {
  name: string;
  path: string;
  children: FolderNode[];
  sessions: Session[];
  /** Sesiones en esta carpeta y todas sus subcarpetas. */
  total: number;
}

export function normPath(p?: string | null): string {
  return (p ?? "")
    .split("/")
    .map((x) => x.trim())
    .filter(Boolean)
    .join("/");
}

export const parentOf = (path: string) => path.split("/").slice(0, -1).join("/");
export const baseName = (path: string) => path.split("/").pop() ?? path;
export const joinPath = (parent: string, name: string) => normPath(parent ? `${parent}/${name}` : name);

/** true si `path` es `ancestor` o está dentro de ella. */
export function isWithin(path: string, ancestor: string): boolean {
  return path === ancestor || path.startsWith(`${ancestor}/`);
}

/** Reemplaza el prefijo `from` por `to` si `path` está dentro de `from`. */
export function rebase(path: string, from: string, to: string): string {
  if (!isWithin(path, from)) return path;
  return normPath(to + path.slice(from.length));
}

/** Todas las rutas existentes (incluye ancestros implícitos), ordenadas. */
export function allFolders(sessions: Session[], extra: string[]): string[] {
  const set = new Set<string>();
  for (const raw of [...sessions.map((s) => s.folder), ...extra]) {
    const parts = normPath(raw).split("/").filter(Boolean);
    for (let i = 1; i <= parts.length; i++) set.add(parts.slice(0, i).join("/"));
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

export function buildTree(sessions: Session[], extra: string[]): FolderNode {
  const root: FolderNode = { name: "", path: "", children: [], sessions: [], total: 0 };
  const index = new Map<string, FolderNode>([["", root]]);

  const ensure = (path: string): FolderNode => {
    const found = index.get(path);
    if (found) return found;
    const parent = ensure(parentOf(path));
    const node: FolderNode = { name: baseName(path), path, children: [], sessions: [], total: 0 };
    parent.children.push(node);
    index.set(path, node);
    return node;
  };

  for (const f of extra) ensure(normPath(f));
  for (const s of sessions) ensure(normPath(s.folder)).sessions.push(s);

  const finish = (n: FolderNode): number => {
    n.children.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    n.sessions.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    n.total = n.sessions.length + n.children.reduce((acc, c) => acc + finish(c), 0);
    return n.total;
  };
  finish(root);
  return root;
}

/** Sesiones de una carpeta y sus subcarpetas. */
export function sessionsWithin(sessions: Session[], path: string): Session[] {
  return sessions.filter((s) => isWithin(normPath(s.folder), path));
}

/** Nombre libre dentro de `parent` ("Nueva carpeta", "Nueva carpeta 2", …). */
export function freeName(existing: string[], parent: string, base = "Nueva carpeta"): string {
  let name = base;
  for (let i = 2; existing.includes(joinPath(parent, name)); i++) name = `${base} ${i}`;
  return joinPath(parent, name);
}
