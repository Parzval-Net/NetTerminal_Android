use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum SessionType {
    Local,
    Ssh,
    Serial,
    Telnet,
    /// TCP sin negociación Telnet (servidores de consola, puertos 2001+).
    Raw,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Session {
    #[serde(default)]
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub session_type: SessionType,
    #[serde(default)]
    pub folder: Option<String>,
    #[serde(default)]
    pub host: Option<String>,
    #[serde(default)]
    pub port: Option<u16>,
    #[serde(default)]
    pub username: Option<String>,
    /// Ruta a la llave privada SSH (opcional, si no se usa ~/.ssh/config o el agente).
    #[serde(default)]
    pub identity_file: Option<String>,
    /// Habilita algoritmos antiguos (equipos de red legacy).
    #[serde(default)]
    pub legacy_ssh: Option<bool>,
    /// Bastión intermedio (ProxyJump), ej. usuario@bastion:22.
    #[serde(default)]
    pub jump_host: Option<String>,
    /// Argumentos extra para ssh (túneles -L/-D, -A, -o ...).
    #[serde(default)]
    pub ssh_args: Option<String>,
    #[serde(default)]
    pub serial_port: Option<String>,
    #[serde(default)]
    pub baud_rate: Option<u32>,
    #[serde(default)]
    pub data_bits: Option<u8>,
    #[serde(default)]
    pub stop_bits: Option<u8>,
    #[serde(default)]
    pub parity: Option<String>,
    #[serde(default)]
    pub flow_control: Option<String>,
    #[serde(default)]
    pub highlight: Option<String>,
    /// Comandos que se envían al conectar (uno por línea).
    #[serde(default)]
    pub on_connect: Option<String>,
    /// Qué envía Enter: "cr" (por defecto), "lf" o "crlf".
    #[serde(default)]
    pub newline: Option<String>,
    #[serde(default)]
    pub local_echo: Option<bool>,
    /// Codificación de la salida: "utf-8" (por defecto), "iso-8859-1", "windows-1252".
    #[serde(default)]
    pub encoding: Option<String>,
    #[serde(default)]
    pub auto_reconnect: Option<bool>,
    /// Plataforma detectada para el catálogo de comandos (ej. "vrp5", "iosxe").
    #[serde(default)]
    pub platform: Option<String>,
    /// Transferencia SCP en una pestaña de terminal (solo pestañas temporales).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scp: Option<ScpSpec>,
    #[serde(default)]
    pub created_at: String,
}

/// Copia SCP entre la carpeta compartida del PC y el equipo.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScpSpec {
    /// true: PC -> equipo. false: equipo -> PC.
    pub upload: bool,
    /// Nombres de archivo (en la carpeta compartida o en el equipo).
    pub files: Vec<String>,
    /// Carpeta o sistema de archivos remoto (ej. "flash:", "/var/tmp/").
    pub remote_dir: String,
    /// Rutas locales absolutas: las resuelve el backend, nunca el frontend.
    #[serde(default, skip_deserializing)]
    pub local_paths: Vec<String>,
    #[serde(default)]
    pub local_dir: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SerialPortInfo {
    pub port_name: String,
    pub port_type: String,
}
