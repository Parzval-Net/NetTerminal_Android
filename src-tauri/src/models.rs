use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum SessionType {
    Local,
    Ssh,
    Serial,
    Telnet,
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
    #[serde(default)]
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SerialPortInfo {
    pub port_name: String,
    pub port_type: String,
}
