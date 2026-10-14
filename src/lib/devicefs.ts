/** Perfiles de sistema de archivos por fabricante: comandos y lectura de "dir". */

export interface RemoteFile {
  name: string;
  size: number;
  date: string;
  dir: boolean;
}

export interface Vars {
  ip: string;
  port: number;
  file: string;
  fs: string;
  extra: string;
}

export interface Profile {
  id: string;
  label: string;
  fs: string;
  list: (fs: string) => string;
  /** El equipo descarga desde este PC. */
  upload: (v: Vars, proto: "tftp" | "http") => string;
  /** El equipo sube a este PC (requiere TFTP con escritura). */
  download: ((v: Vars) => string) | null;
  backup: ((v: Vars) => string) | null;
  /** Comando que muestra el MD5 de un archivo en el equipo (verificación de firmware). */
  md5: ((v: Vars) => string) | null;
  note?: string;
}

/** Extrae el último hash MD5 (32 hex) de la salida del equipo. */
export function parseMd5(output: string): string | null {
  const all = output.toLowerCase().match(/\b[0-9a-f]{32}\b/g);
  return all ? all[all.length - 1] : null;
}

const join = (fs: string, file: string) => (fs.endsWith("/") || fs.endsWith(":") ? `${fs}${file}` : `${fs}/${file}`);
const sfx = (extra: string) => (extra.trim() ? ` ${extra.trim()}` : "");

export const profiles: Profile[] = [
  {
    id: "cisco",
    label: "Cisco IOS / IOS-XE / Arista",
    fs: "flash:",
    list: (fs) => `dir ${fs}`,
    upload: (v, proto) =>
      proto === "http"
        ? `copy http://${v.ip}:${v.port}/${v.file} ${join(v.fs, v.file)}${sfx(v.extra)}`
        : `copy tftp://${v.ip}/${v.file} ${join(v.fs, v.file)}${sfx(v.extra)}`,
    download: (v) => `copy ${join(v.fs, v.file)} tftp://${v.ip}/${v.file}${sfx(v.extra)}`,
    backup: (v) => `copy running-config tftp://${v.ip}/${v.file}${sfx(v.extra)}`,
    md5: (v) => `verify /md5 ${join(v.fs, v.file)}`,
  },
  {
    id: "nxos",
    label: "Cisco NX-OS",
    fs: "bootflash:",
    list: (fs) => `dir ${fs}`,
    upload: (v, proto) =>
      `copy ${proto}://${v.ip}${proto === "http" ? `:${v.port}` : ""}/${v.file} ${join(v.fs, v.file)} vrf ${v.extra.trim() || "management"}`,
    download: (v) => `copy ${join(v.fs, v.file)} tftp://${v.ip}/${v.file} vrf ${v.extra.trim() || "management"}`,
    backup: (v) => `copy running-config tftp://${v.ip}/${v.file} vrf ${v.extra.trim() || "management"}`,
    md5: (v) => `show file ${join(v.fs, v.file)} md5sum`,
    note: "En NX-OS el campo extra es la VRF (por defecto management).",
  },
  {
    id: "huawei",
    label: "Huawei VRP / H3C",
    fs: "flash:/",
    list: (fs) => `dir ${fs}`,
    upload: (v) => `tftp ${v.ip} get ${v.file}`,
    download: (v) => `tftp ${v.ip} put ${v.file}`,
    backup: null,
    md5: null,
    note: "VRP guarda en el directorio actual; usa 'cd flash:/' antes si cambiaste de carpeta.",
  },
  {
    id: "juniper",
    label: "Juniper Junos",
    fs: "/var/tmp/",
    list: (fs) => `file list ${fs} detail | no-more`,
    upload: (v, proto) =>
      `file copy ${proto}://${v.ip}${proto === "http" ? `:${v.port}` : ""}/${v.file} ${v.fs}`,
    download: null,
    backup: null,
    md5: (v) => `file checksum md5 ${v.fs}${v.file}`,
    note: "Junos no sube archivos por TFTP; para extraer usa SCP (cifrado).",
  },
];

const units: Record<string, number> = { "": 1, B: 1, BYTES: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3 };
const num = (s: string) => Number(s.replace(/[,.](?=\d{3}\b)/g, ""));

/** Lee la salida de dir / file list. Reconoce Cisco, Huawei y Junos. */
export function parseListing(output: string): { files: RemoteFile[]; free: number | null; total: number | null } {
  const files: RemoteFile[] = [];
  for (const raw of output.split("\n")) {
    const line = raw.replace(/\r/g, "").trimEnd();
    // Cisco:  "  1  -rw-   33591768  Mar 1 1993 00:04:25 +00:00  c2960.bin"
    // Huawei: "  0  -rw-   125,644,800  Jun 01 2023 10:00:00   s5735.cc"
    let m = line.match(/^\s*\d+\s+([-dlrwx]{3,10})\s+([\d,.]+)\s+(.+?)\s{1,}(\S+)$/);
    if (m && /\d{1,2}:\d{2}|<no date>|\d{4}/.test(m[3])) {
      files.push({ name: m[4], size: num(m[2]), date: m[3].trim(), dir: m[1].startsWith("d") });
      continue;
    }
    // Junos: "-rw-r--r--  1 root  wheel   12345 Jan  1 12:00 junos.tgz"
    m = line.match(/^([-dl][-rwxst]{9})\s+\d+\s+\S+\s+\S+\s+(\d+)\s+(\w{3}\s+\d+\s+[\d:]+)\s+(.+)$/);
    if (m) files.push({ name: m[4].replace(/\/$/, ""), size: Number(m[2]), date: m[3], dir: m[1].startsWith("d") });
  }
  const freeM = output.match(/([\d,.]+)\s*(bytes|KB|MB|GB)?\s*(?:total[^()\n]*)?\(\s*([\d,.]+)\s*(bytes|KB|MB|GB)?\s*free\)/i);
  const total = freeM ? num(freeM[1]) * (units[(freeM[2] ?? "").toUpperCase()] ?? 1) : null;
  const free = freeM ? num(freeM[3]) * (units[(freeM[4] ?? freeM[2] ?? "").toUpperCase()] ?? 1) : null;
  return { files, free, total };
}

/** Sugiere el perfil según el resaltado configurado en la sesión. */
export function guessProfile(highlight?: string): string {
  if (highlight === "huawei") return "huawei";
  if (highlight === "juniper") return "juniper";
  return "cisco";
}
