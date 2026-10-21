//! Herramientas de red: traceroute, iperf3 (cliente/servidor), verificación de puertos,
//! interfaces locales y speedtest contra Cloudflare.

use crate::monitor::{command, resolve, tcp_probe_addrs, validate_host};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read};
use std::process::{Child, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

#[derive(Serialize, Clone)]
struct JobEvent {
    job: String,
    kind: &'static str, // "line" | "done" | "error" | "result"
    text: String,
    data: Option<Value>,
}

#[derive(Default)]
pub struct Jobs {
    children: Arc<Mutex<HashMap<String, Arc<Mutex<Child>>>>>,
    cancels: Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>,
}

#[derive(Deserialize)]
pub struct IperfParams {
    pub host: Option<String>,
    pub port: Option<u16>,
    pub seconds: Option<u32>,
    pub reverse: Option<bool>,
    pub udp: Option<bool>,
    pub bandwidth: Option<String>,
    pub parallel: Option<u8>,
    pub server: Option<bool>,
}

fn emit(app: &AppHandle, job: &str, kind: &'static str, text: String, data: Option<Value>) {
    let _ = app.emit("tool-job", JobEvent { job: job.into(), kind, text, data });
}

impl Jobs {
    pub fn stop(&self, job: &str) {
        if let Some(c) = self.children.lock().unwrap().remove(job) {
            let _ = c.lock().unwrap().kill();
        }
        if let Some(f) = self.cancels.lock().unwrap().remove(job) {
            f.store(true, Ordering::SeqCst);
        }
    }

    /// Ejecuta un comando y transmite cada línea de salida como evento.
    fn spawn(&self, app: AppHandle, mut cmd: std::process::Command, collect_json: bool) -> Result<String, String> {
        cmd.stdout(Stdio::piped()).stderr(Stdio::piped()).stdin(Stdio::null());
        let mut child = cmd.spawn().map_err(|e| format!("No se pudo ejecutar: {e}"))?;
        let stdout = child.stdout.take().ok_or("sin salida")?;
        let stderr = child.stderr.take().ok_or("sin salida")?;
        let job = uuid::Uuid::new_v4().to_string();
        let child = Arc::new(Mutex::new(child));
        self.children.lock().unwrap().insert(job.clone(), child.clone());

        let (a2, j2) = (app.clone(), job.clone());
        std::thread::spawn(move || {
            for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                emit(&a2, &j2, "line", line, None);
            }
        });
        let id = job.clone();
        let children = self.children.clone();
        std::thread::spawn(move || {
            let mut json_buf = String::new();
            if collect_json {
                let _ = BufReader::new(stdout).read_to_string(&mut json_buf);
            } else {
                for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                    emit(&app, &id, "line", line, None);
                }
            }
            // Espera sin retener el lock: así "Detener" (que necesita el lock para matar el
            // proceso) no queda bloqueado hasta que el proceso termine solo.
            let status = loop {
                match child.lock().unwrap().try_wait() {
                    Ok(Some(st)) => break Ok(st),
                    Ok(None) => {}
                    Err(e) => break Err(e),
                }
                std::thread::sleep(Duration::from_millis(100));
            };
            children.lock().unwrap().remove(&id);
            if collect_json {
                match serde_json::from_str::<Value>(&json_buf) {
                    Ok(v) if v.get("error").is_some() => {
                        emit(&app, &id, "error", v["error"].as_str().unwrap_or("error").into(), None)
                    }
                    Ok(v) => emit(&app, &id, "result", String::new(), Some(summarize_iperf(&v))),
                    Err(_) if !json_buf.trim().is_empty() => emit(&app, &id, "line", json_buf, None),
                    Err(_) => {}
                }
            }
            let code = status.ok().and_then(|s| s.code()).unwrap_or(-1);
            emit(&app, &id, "done", format!("Finalizado (código {code})"), None);
        });
        Ok(job)
    }

    pub fn traceroute(&self, app: AppHandle, host: &str) -> Result<String, String> {
        validate_host(host)?;
        let cmd = if cfg!(windows) {
            let mut c = command("tracert");
            c.args(["-d", "-w", "2000", "-h", "30", host]);
            c
        } else if which("traceroute") {
            let mut c = command(if host.contains(':') && cfg!(target_os = "macos") { "traceroute6" } else { "traceroute" });
            c.args(["-n", "-w", "2", "-q", "1", "-m", "30", host]);
            c
        } else if which("tracepath") {
            let mut c = command("tracepath");
            c.args(["-n", host]);
            c
        } else {
            return Err("No se encontró traceroute ni tracepath en el sistema".into());
        };
        self.spawn(app, cmd, false)
    }

    pub fn iperf(&self, app: AppHandle, p: IperfParams) -> Result<String, String> {
        if iperf_version().is_none() {
            return Err("iperf3 no está instalado. Instálalo desde iperf.fr o con el gestor de paquetes.".into());
        }
        let mut c = command("iperf3");
        let port = p.port.unwrap_or(5201).to_string();
        if p.server.unwrap_or(false) {
            c.args(["-s", "-p", &port, "--forceflush"]);
            return self.spawn(app, c, false);
        }
        let host = p.host.unwrap_or_default();
        validate_host(&host)?;
        c.args(["-c", &host, "-p", &port, "-J"]);
        c.args(["-t", &p.seconds.unwrap_or(10).clamp(1, 300).to_string()]);
        c.args(["-P", &p.parallel.unwrap_or(1).clamp(1, 32).to_string()]);
        if p.reverse.unwrap_or(false) {
            c.arg("-R");
        }
        if p.udp.unwrap_or(false) {
            c.arg("-u");
            let bw = p.bandwidth.unwrap_or_else(|| "100M".into());
            if !bw.chars().all(|ch| ch.is_ascii_alphanumeric() || ch == '.') {
                return Err("Ancho de banda inválido (ej: 100M, 1G)".into());
            }
            c.args(["-b", &bw]);
        }
        self.spawn(app, c, true)
    }

    /// Speedtest con los endpoints públicos de speed.cloudflare.com.
    pub fn speedtest(&self, app: AppHandle) -> Result<String, String> {
        let job = uuid::Uuid::new_v4().to_string();
        let cancel = Arc::new(AtomicBool::new(false));
        self.cancels.lock().unwrap().insert(job.clone(), cancel.clone());
        let id = job.clone();
        let cancels = self.cancels.clone();
        std::thread::spawn(move || {
            let res = run_speedtest(&app, &id, &cancel);
            cancels.lock().unwrap().remove(&id);
            match res {
                Ok(v) => emit(&app, &id, "result", String::new(), Some(v)),
                Err(e) => emit(&app, &id, "error", e, None),
            }
            emit(&app, &id, "done", String::new(), None);
        });
        Ok(job)
    }
}

fn which(bin: &str) -> bool {
    command(bin).arg("--version").stdout(Stdio::null()).stderr(Stdio::null()).status().is_ok()
        || command("sh").args(["-c", &format!("command -v {bin}")]).output().map(|o| o.status.success()).unwrap_or(false)
}

pub fn iperf_version() -> Option<String> {
    let out = command("iperf3").arg("--version").output().ok()?;
    let v = String::from_utf8_lossy(&out.stdout).lines().next()?.trim().to_string();
    v.starts_with("iperf").then_some(v)
}

/// Resumen legible del JSON de iperf3.
fn summarize_iperf(v: &Value) -> Value {
    let end = &v["end"];
    let mbps = |x: &Value| x["bits_per_second"].as_f64().map(|b| (b / 1e6 * 100.0).round() / 100.0);
    let intervals: Vec<f64> = v["intervals"]
        .as_array()
        .map(|a| a.iter().filter_map(|i| mbps(&i["sum"])).collect())
        .unwrap_or_default();
    let udp = end.get("sum").is_some() && end["sum"].get("jitter_ms").is_some();
    json!({
        "protocol": if udp { "UDP" } else { "TCP" },
        "sent_mbps": mbps(&end["sum_sent"]).or(mbps(&end["sum"])),
        "received_mbps": mbps(&end["sum_received"]).or(mbps(&end["sum"])),
        "retransmits": end["sum_sent"]["retransmits"],
        "jitter_ms": end["sum"]["jitter_ms"],
        "lost_percent": end["sum"]["lost_percent"],
        "cpu_local": end["cpu_utilization_percent"]["host_total"],
        "cpu_remote": end["cpu_utilization_percent"]["remote_total"],
        "remote": v["start"]["connected"][0]["remote_host"],
        "intervals": intervals,
    })
}

// ---------- Puertos e interfaces ----------

#[derive(Serialize)]
pub struct PortResult {
    port: u16,
    open: bool,
    rtt: Option<f64>,
    error: Option<String>,
}

pub fn check_ports(host: &str, ports: Vec<u16>, timeout_ms: u64) -> Result<Vec<PortResult>, String> {
    validate_host(host)?;
    if ports.len() > 1024 {
        return Err("Máximo 1024 puertos por consulta".into());
    }
    let timeout = Duration::from_millis(timeout_ms.clamp(100, 10_000));
    // El host se resuelve una vez (antes era una consulta DNS por puerto) y en cada
    // puerto solo cambia el número.
    let addrs = resolve(host, 0);
    // Pool acotado: un hilo y un socket por puerto agotaba los descriptores (macOS limita
    // a 256 por app) y hacía fallar sesiones nuevas mientras corría el escaneo.
    const WORKERS: usize = 64;
    let workers = WORKERS.min(ports.len());
    let queue = Arc::new(Mutex::new(ports.into_iter()));
    let results = Arc::new(Mutex::new(Vec::new()));
    let addrs = Arc::new(addrs);
    let handles: Vec<_> = (0..workers)
        .map(|_| {
            let (queue, results, addrs) = (queue.clone(), results.clone(), addrs.clone());
            std::thread::spawn(move || loop {
                let Some(port) = queue.lock().unwrap().next() else { break };
                let (open, rtt, error) = match addrs.as_ref() {
                    Ok(list) => {
                        let list: Vec<_> = list.iter().map(|a| std::net::SocketAddr::new(a.ip(), port)).collect();
                        tcp_probe_addrs(&list, timeout)
                    }
                    Err(e) => (false, None, Some(e.clone())),
                };
                results.lock().unwrap().push(PortResult { port, open, rtt, error });
            })
        })
        .collect();
    for h in handles {
        let _ = h.join();
    }
    let mut out = std::mem::take(&mut *results.lock().unwrap());
    out.sort_by_key(|r| r.port);
    Ok(out)
}

#[derive(Serialize)]
pub struct LocalIf {
    name: String,
    ip: String,
}

pub fn local_ips() -> Vec<LocalIf> {
    let mut list: Vec<_> = if_addrs::get_if_addrs()
        .unwrap_or_default()
        .into_iter()
        .filter(|i| !i.is_loopback() && i.ip().is_ipv4())
        .map(|i| LocalIf { name: i.name.clone(), ip: i.ip().to_string() })
        .collect();
    list.sort_by(|a, b| a.name.cmp(&b.name));
    list
}

// ---------- Speedtest ----------

const CF: &str = "https://speed.cloudflare.com";

fn agent() -> ureq::Agent {
    ureq::AgentBuilder::new()
        .timeout(Duration::from_secs(60))
        .try_proxy_from_env(true)
        .user_agent(concat!("NetTerminal/", env!("CARGO_PKG_VERSION")))
        .build()
}

fn percentile(mut v: Vec<f64>, p: f64) -> f64 {
    if v.is_empty() {
        return 0.0;
    }
    v.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let idx = ((v.len() - 1) as f64 * p).round() as usize;
    v[idx]
}

/// Suma todos los `dur=` de Server-Timing (Cloudflare informa edge y worker por
/// separado). Restarlos al tiempo total deja la latencia de red: medido contra ping,
/// descontar solo el primero sobreestima la latencia unas 4 veces.
fn server_time_ms(headers: &[&str]) -> f64 {
    headers
        .iter()
        .flat_map(|h| h.split([',', ';']))
        .filter_map(|part| part.trim().strip_prefix("dur="))
        .filter_map(|d| d.parse::<f64>().ok())
        .sum()
}

fn run_speedtest(app: &AppHandle, job: &str, cancel: &AtomicBool) -> Result<Value, String> {
    let agent = agent();
    let progress = |phase: &str, value: f64, pct: f64| {
        emit(app, job, "line", String::new(), Some(json!({"phase": phase, "value": value, "progress": pct})));
    };

    // Latencia: tiempo de respuesta menos el tiempo de proceso informado por el servidor.
    let mut latencies = Vec::new();
    let mut meta = json!({});
    for i in 0..20 {
        if cancel.load(Ordering::SeqCst) {
            return Err("Cancelado".into());
        }
        let t0 = Instant::now();
        let resp = agent.get(&format!("{CF}/__down?bytes=0")).call().map_err(|e| format!("Sin conexión con Cloudflare: {e}"))?;
        let total = t0.elapsed().as_secs_f64() * 1000.0;
        let server = server_time_ms(&resp.all("server-timing"));
        if i == 0 {
            meta = json!({
                "colo": resp.header("cf-meta-colo")
                    .map(str::to_owned)
                    .or_else(|| resp.header("cf-ray").and_then(|r| r.rsplit('-').next()).map(str::to_owned)),
                "city": resp.header("cf-meta-city"),
                "country": resp.header("cf-meta-country"),
                "asn": resp.header("cf-meta-asn"),
            });
        }
        if i > 0 {
            latencies.push((total - server).max(0.0));
        }
        progress("latency", total, (i + 1) as f64 / 20.0);
    }
    let latency = percentile(latencies.clone(), 0.5);
    let jitter = if latencies.len() > 1 {
        latencies.windows(2).map(|w| (w[1] - w[0]).abs()).sum::<f64>() / (latencies.len() - 1) as f64
    } else {
        0.0
    };

    // Bajada y subida: varias mediciones; se informa el percentil 90 (criterio de Cloudflare).
    let down_sizes = [100_000usize, 1_000_000, 1_000_000, 10_000_000, 10_000_000, 25_000_000, 25_000_000];
    let mut down = Vec::new();
    for (i, size) in down_sizes.iter().enumerate() {
        if cancel.load(Ordering::SeqCst) {
            return Err("Cancelado".into());
        }
        let t0 = Instant::now();
        let resp = agent.get(&format!("{CF}/__down?bytes={size}")).call().map_err(|e| e.to_string())?;
        let mut reader = resp.into_reader();
        let mut buf = vec![0u8; 64 * 1024];
        let mut n = 0usize;
        loop {
            let r = reader.read(&mut buf).map_err(|e| e.to_string())?;
            if r == 0 {
                break;
            }
            n += r;
        }
        let secs = t0.elapsed().as_secs_f64().max(0.001);
        let mbps = n as f64 * 8.0 / secs / 1e6;
        if *size >= 1_000_000 {
            down.push(mbps);
        }
        progress("download", mbps, (i + 1) as f64 / down_sizes.len() as f64);
    }

    let up_sizes = [1_000_000usize, 1_000_000, 5_000_000, 5_000_000, 10_000_000];
    let mut up = Vec::new();
    for (i, size) in up_sizes.iter().enumerate() {
        if cancel.load(Ordering::SeqCst) {
            return Err("Cancelado".into());
        }
        let body = vec![0u8; *size];
        let t0 = Instant::now();
        agent
            .post(&format!("{CF}/__up"))
            .set("Content-Type", "application/octet-stream")
            .send_bytes(&body)
            .map_err(|e| e.to_string())?;
        let mbps = *size as f64 * 8.0 / t0.elapsed().as_secs_f64().max(0.001) / 1e6;
        up.push(mbps);
        progress("upload", mbps, (i + 1) as f64 / up_sizes.len() as f64);
    }

    let round = |x: f64| (x * 100.0).round() / 100.0;
    Ok(json!({
        "latency_ms": round(latency),
        "jitter_ms": round(jitter),
        "download_mbps": round(percentile(down, 0.9)),
        "upload_mbps": round(percentile(up, 0.9)),
        "server": meta,
        "ts": chrono::Local::now().to_rfc3339(),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn summarizes_iperf_tcp_json() {
        let v = json!({
            "start": {"connected": [{"remote_host": "10.0.0.2"}]},
            "intervals": [{"sum": {"bits_per_second": 9.4e8}}, {"sum": {"bits_per_second": 9.5e8}}],
            "end": {
                "sum_sent": {"bits_per_second": 9.45e8, "retransmits": 3},
                "sum_received": {"bits_per_second": 9.41e8},
                "cpu_utilization_percent": {"host_total": 12.5, "remote_total": 8.0}
            }
        });
        let s = summarize_iperf(&v);
        assert_eq!(s["protocol"], "TCP");
        assert_eq!(s["sent_mbps"], 945.0);
        assert_eq!(s["received_mbps"], 941.0);
        assert_eq!(s["retransmits"], 3);
        assert_eq!(s["intervals"].as_array().unwrap().len(), 2);
    }

    #[test]
    fn port_check_and_limits() {
        let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let open = l.local_addr().unwrap().port();
        let r = check_ports("127.0.0.1", vec![open], 500).unwrap();
        assert!(r[0].open);
        assert!(check_ports("-x", vec![22], 500).is_err());
        assert!(check_ports("127.0.0.1", (1..=2000).collect(), 100).is_err());
    }

    #[test]
    fn port_check_resolves_once_and_reports_dns_errors() {
        let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let open = l.local_addr().unwrap().port();
        let r = check_ports("localhost", vec![open, 1], 500).unwrap();
        assert!(r.iter().any(|p| p.port == open && p.open));
        let r = check_ports("no-existe.invalid", vec![22, 23], 200).unwrap();
        assert!(r.iter().all(|p| !p.open && p.error.as_deref().unwrap().starts_with("DNS:")));
    }

    /// cargo test --release -- --ignored --nocapture bench_
    #[test]
    #[ignore]
    fn bench_dns_per_port() {
        let t = Instant::now();
        for _ in 0..200 {
            let _ = crate::monitor::resolve("localhost", 22);
        }
        println!("200 resoluciones de localhost: {:?}", t.elapsed());
        let t = Instant::now();
        let _ = check_ports("localhost", (40000..40200).collect(), 200);
        println!("check_ports localhost x200 (cerrados): {:?}", t.elapsed());
        // Equivalente al código anterior: resolver en cada puerto, mismo pool de 64 hilos.
        let t = Instant::now();
        let queue = Arc::new(Mutex::new(40000u16..40200));
        let hs: Vec<_> = (0..64)
            .map(|_| {
                let q = queue.clone();
                std::thread::spawn(move || loop {
                    let Some(port) = q.lock().unwrap().next() else { break };
                    let _ = crate::monitor::tcp_probe("localhost", port, Duration::from_millis(200));
                })
            })
            .collect();
        hs.into_iter().for_each(|h| h.join().unwrap());
        println!("antes (DNS por puerto) x200: {:?}", t.elapsed());
    }

    #[test]
    fn sums_all_server_timing_durations() {
        let h = ["cfSpeedEdge;dur=4, cfSpeedWorker;dur=21", "cfL4;desc=\"?proto=TCP&rtt=4197\""];
        assert_eq!(server_time_ms(&h), 25.0);
        assert_eq!(server_time_ms(&[]), 0.0);
    }

    #[test]
    fn percentile_math() {
        assert_eq!(percentile(vec![1.0, 2.0, 3.0, 4.0, 5.0], 0.5), 3.0);
        assert_eq!(percentile(vec![], 0.9), 0.0);
    }
}
