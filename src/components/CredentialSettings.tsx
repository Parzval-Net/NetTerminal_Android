import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { KeyRound, Lock, ShieldCheck } from "lucide-react";
import { CredStatus, credStatus, masterStrength, strengthText } from "../lib/credentials";
import { isMac } from "../lib/platform";
import { VaultUnlock } from "./VaultUnlock";

const KEYCHAIN = isMac
  ? "Llavero de macOS (Keychain)"
  : navigator.userAgent.includes("Windows")
    ? "Administrador de credenciales de Windows"
    : "Secret Service (GNOME Keyring / KWallet)";

/** Ajustes › Credenciales: estado de la bóveda y contraseña maestra. */
export function CredentialSettings() {
  const [st, setSt] = useState<CredStatus | null>(null);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const refresh = () => credStatus().then(setSt).catch((e) => setMsg({ text: String(e), error: true }));
  useEffect(() => {
    refresh();
  }, []);

  const run = async (cmd: string, args: Record<string, unknown>, ok: string) => {
    setMsg(null);
    try {
      await invoke(cmd, args);
      setMsg({ text: ok });
      await refresh();
      return true;
    } catch (e) {
      setMsg({ text: String(e), error: true });
      return false;
    }
  };

  if (!st) return <p className="text-muted">Consultando…</p>;
  const keychain = st.backend === "keychain";

  return (
    <div className="space-y-4">
      <div className="flex gap-3 p-3 rounded-lg border border-line">
        <ShieldCheck size={18} className="text-accent shrink-0 mt-0.5" />
        <div className="space-y-1 text-[12.5px]">
          <p className="font-medium">
            {keychain
              ? `Bóveda cifrada con llave en el ${KEYCHAIN}`
              : `Bóveda cifrada con contraseña maestra${st.portable ? " (modo portable)" : ""}`}
          </p>
          <p className="text-[11.5px] text-muted">
            Las contraseñas de sesión se guardan cifradas (XChaCha20-Poly1305) en <code>credentials.vault</code> dentro de
            la carpeta de datos. Nunca se muestran, no van en logs, exportaciones ni respaldos de sesiones, y solo se usan
            para completar el login al conectar.{" "}
            {keychain
              ? "La llave vive en el llavero del sistema: el archivo copiado a otro equipo no sirve."
              : "La llave se deriva de tu contraseña maestra (Argon2id) y queda en memoria solo mientras la app está abierta y desbloqueada."}
          </p>
          <p className="text-[11.5px]">
            Estado:{" "}
            <span className={st.exists && (keychain || st.unlocked) ? "text-accent" : "text-muted"}>
              {!st.exists ? "sin bóveda" : keychain ? "activa" : st.unlocked ? "desbloqueada" : "bloqueada"}
            </span>
          </p>
        </div>
      </div>

      {!keychain && !st.exists && <CreateVault onCreate={(m) => run("vault_create", { master: m }, "Bóveda creada y desbloqueada")} />}

      {!keychain && st.exists && !st.unlocked && (
        <div className="space-y-1.5">
          <Label>Desbloquear</Label>
          <VaultUnlock
            onUnlocked={() => {
              setMsg({ text: "Bóveda desbloqueada" });
              refresh();
            }}
          />
        </div>
      )}

      {!keychain && st.exists && st.unlocked && (
        <>
          <div className="flex items-center justify-between gap-4">
            <span>
              Bloquear ahora
              <span className="block text-[11.5px] text-muted">Borra la llave de memoria. También se bloquea al cerrar la app.</span>
            </span>
            <button
              onClick={() => run("vault_lock", {}, "Bóveda bloqueada")}
              className="flex items-center gap-1.5 px-3 h-7 rounded-md border border-line hover:bg-hover"
            >
              <Lock size={13} /> Bloquear
            </button>
          </div>
          <ChangeMaster onChange={(o, n) => run("vault_change", { old: o, new: n }, "Contraseña maestra cambiada")} />
        </>
      )}

      {msg && <p className={`text-[11.5px] ${msg.error ? "text-danger" : "text-accent"}`}>{msg.text}</p>}

      {st.exists && (
        <div className="pt-3 border-t border-line flex items-center justify-between gap-4">
          <span>
            Restablecer bóveda
            <span className="block text-[11.5px] text-muted">
              Si olvidaste la contraseña maestra o cambiaste de equipo. Borra todas las contraseñas guardadas.
            </span>
          </span>
          {confirmReset ? (
            <div className="flex gap-1.5 shrink-0">
              <button onClick={() => setConfirmReset(false)} className="px-3 h-7 rounded-md border border-line hover:bg-hover">
                Cancelar
              </button>
              <button
                onClick={async () => {
                  setConfirmReset(false);
                  await run("vault_reset", {}, "Bóveda eliminada. Las sesiones piden la contraseña en la terminal.");
                }}
                className="px-3 h-7 rounded-md bg-danger text-white font-medium hover:opacity-90"
              >
                Borrar todo
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmReset(true)}
              className="px-3 h-7 rounded-md border border-line text-danger hover:bg-hover shrink-0"
            >
              Restablecer…
            </button>
          )}
        </div>
      )}

      <p className="text-[11.5px] text-muted">
        Recomendación: para SSH prefiere llaves y agente. Guarda contraseñas solo en equipos corporativos con disco cifrado y
        sesión bloqueada al ausentarte. No compartas tu contraseña maestra.
      </p>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <div className="text-[11.5px] font-medium text-muted">{children}</div>;
}

function Strength({ pw }: { pw: string }) {
  if (!pw) return null;
  const s = masterStrength(pw);
  const color = ["bg-danger", "bg-warn", "bg-accent", "bg-accent"][s];
  return (
    <div className="flex items-center gap-2 text-[11px] text-muted">
      <div className="flex gap-0.5">
        {[0, 1, 2].map((i) => (
          <span key={i} className={`w-8 h-1 rounded ${i < Math.max(1, s) ? color : "bg-line"}`} />
        ))}
      </div>
      {strengthText[s]}
    </div>
  );
}

function CreateVault({ onCreate }: { onCreate: (master: string) => Promise<boolean> }) {
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const ok = a.length >= 8 && a === b;
  return (
    <form
      className="space-y-2"
      onSubmit={async (e) => {
        e.preventDefault();
        if (ok && (await onCreate(a))) {
          setA("");
          setB("");
        }
      }}
    >
      <Label>Crear bóveda</Label>
      <p className="text-[11.5px] text-muted">
        Elige una contraseña maestra larga (una frase de 4 o más palabras funciona bien). Si la olvidas, las contraseñas
        guardadas no se pueden recuperar.
      </p>
      <input type="password" autoComplete="new-password" className="field" placeholder="Contraseña maestra" value={a} onChange={(e) => setA(e.target.value)} />
      <Strength pw={a} />
      <input type="password" autoComplete="new-password" className="field" placeholder="Confirmar" value={b} onChange={(e) => setB(e.target.value)} />
      {b && a !== b && <p className="text-[11.5px] text-danger">No coinciden</p>}
      <button
        disabled={!ok}
        className="flex items-center gap-1.5 px-3 h-8 rounded-md bg-accent text-accent-fg font-medium hover:opacity-90 disabled:opacity-50"
      >
        <KeyRound size={13} /> Crear bóveda
      </button>
    </form>
  );
}

function ChangeMaster({ onChange }: { onChange: (old: string, next: string) => Promise<boolean> }) {
  const [old, setOld] = useState("");
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const ok = !!old && a.length >= 8 && a === b;
  return (
    <details className="rounded-lg border border-line">
      <summary className="px-3 h-9 flex items-center text-[12.5px] cursor-default">Cambiar contraseña maestra</summary>
      <form
        className="px-3 pb-3 space-y-2"
        onSubmit={async (e) => {
          e.preventDefault();
          if (ok && (await onChange(old, a))) {
            setOld("");
            setA("");
            setB("");
          }
        }}
      >
        <input type="password" autoComplete="current-password" className="field" placeholder="Actual" value={old} onChange={(e) => setOld(e.target.value)} />
        <input type="password" autoComplete="new-password" className="field" placeholder="Nueva" value={a} onChange={(e) => setA(e.target.value)} />
        <Strength pw={a} />
        <input type="password" autoComplete="new-password" className="field" placeholder="Confirmar nueva" value={b} onChange={(e) => setB(e.target.value)} />
        {b && a !== b && <p className="text-[11.5px] text-danger">No coinciden</p>}
        <button disabled={!ok} className="px-3 h-8 rounded-md border border-line hover:bg-hover disabled:opacity-50">
          Cambiar
        </button>
      </form>
    </details>
  );
}
