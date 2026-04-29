// src/upstream.rs
// 上游代理自动检测

use std::net::TcpStream;
use std::time::Duration;

/// 常见代理端口及对应的工具名称
const KNOWN_PROXIES: &[(&str, u16)] = &[
    ("Clash Verge Rev", 7897),
    ("Clash (默认)", 7890),
    ("Clash (混合)", 7891),
    ("V2RayN/V2RayU", 10809),
    ("Shadowsocks", 1087),
    ("Surge", 6152),
    ("Quantumult X", 7893),
    ("Proxifier", 9090),
];

/// 检测结果
pub struct DetectResult {
    pub name: String,
    pub addr: String,
}

/// 自动检测本地运行的代理
pub fn detect() -> Option<DetectResult> {
    // 1. 先检查系统代理设置（scutil --proxy）
    if let Some(sys) = detect_from_system() {
        return Some(sys);
    }

    // 2. 探测已知端口
    for (name, port) in KNOWN_PROXIES {
        if probe_port("127.0.0.1", *port) {
            return Some(DetectResult {
                name: name.to_string(),
                addr: format!("http://127.0.0.1:{port}"),
            });
        }
    }

    None
}

/// 从系统代理设置检测
fn detect_from_system() -> Option<DetectResult> {
    let output = std::process::Command::new("scutil")
        .arg("--proxy")
        .output()
        .ok()?;
    let stdout = String::from_utf8_lossy(&output.stdout);

    let mut http_enabled = false;
    let mut http_host = String::new();
    let mut http_port: u16 = 0;

    for line in stdout.lines() {
        let trimmed = line.trim();
        if let Some((key, val)) = trimmed.split_once(':') {
            let key = key.trim();
            let val = val.trim();
            match key {
                "HTTPEnable" | "HTTPSEnable" => {
                    if val == "1" {
                        http_enabled = true;
                    }
                }
                "HTTPProxy" | "HTTPSProxy" => {
                    if !val.is_empty() && http_host.is_empty() {
                        http_host = val.to_string();
                    }
                }
                "HTTPPort" | "HTTPSPort" => {
                    if let Ok(p) = val.parse::<u16>() {
                        if p > 0 && http_port == 0 {
                            http_port = p;
                        }
                    }
                }
                _ => {}
            }
        }
    }

    if http_enabled && !http_host.is_empty() && http_port > 0 {
        // 不要把自己当上游（避免环路）
        if http_host == "127.0.0.1" || http_host == "localhost" {
            // 检查是不是 FigCN 自己设置的（看 PID 文件）
            let pid_path = crate::cert::figcn_dir().join("figcn.pid");
            if pid_path.exists() {
                return None; // 可能是自己之前设的
            }
        }

        // 验证端口可达
        if probe_port(&http_host, http_port) {
            return Some(DetectResult {
                name: format!("系统代理 ({http_host}:{http_port})"),
                addr: format!("http://{http_host}:{http_port}"),
            });
        }
    }

    None
}

/// TCP 端口探测（超时 200ms）
fn probe_port(host: &str, port: u16) -> bool {
    let addr = format!("{host}:{port}");
    TcpStream::connect_timeout(
        &addr.parse().unwrap_or_else(|_| {
            format!("127.0.0.1:{port}").parse().unwrap()
        }),
        Duration::from_millis(200),
    )
    .is_ok()
}

/// 打印检测结果
pub fn print_detect_info(result: &Option<DetectResult>) {
    match result {
        Some(r) => {
            println!("📡 检测到上游代理：{} → {}", r.name, r.addr);
            println!("   FigCN 将自动通过该代理转发非 Figma 流量。");
        }
        None => {
            println!("📡 未检测到上游代理，使用直连模式。");
        }
    }
}
