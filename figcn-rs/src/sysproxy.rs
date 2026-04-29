// src/sysproxy.rs
// macOS 系统代理管理（通过 networksetup 命令行工具）

use serde::{Deserialize, Serialize};
use std::fs;
use std::process::Command;

use crate::cert::figcn_dir;

const BACKUP_FILENAME: &str = "proxy-backup.json";

#[derive(Debug, Serialize, Deserialize)]
struct ProxyBackup {
    ts: u64,
    services: Vec<ServiceSnapshot>,
}

#[derive(Debug, Serialize, Deserialize)]
struct ServiceSnapshot {
    name: String,
    web: String,
    sec: String,
    auto_url: String,
    auto_state: String,
}

fn backup_path() -> std::path::PathBuf {
    figcn_dir().join(BACKUP_FILENAME)
}

/// 列出所有网络服务
fn list_services() -> anyhow::Result<Vec<String>> {
    let output = Command::new("networksetup")
        .arg("-listallnetworkservices")
        .output()?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    Ok(stdout
        .lines()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty() && !s.starts_with("An asterisk"))
        .collect())
}

fn get_setting(flag: &str, service: &str) -> String {
    Command::new("networksetup")
        .args([flag, service])
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).to_string())
        .unwrap_or_default()
}

/// 设置系统代理
pub fn set(host: &str, port: u16) -> anyhow::Result<()> {
    let services = list_services()?;
    if services.is_empty() {
        anyhow::bail!("未找到网络服务");
    }

    // 备份当前设置
    let mut snapshots = Vec::new();
    for svc in &services {
        snapshots.push(ServiceSnapshot {
            name: svc.clone(),
            web: get_setting("-getwebproxy", svc),
            sec: get_setting("-getsecurewebproxy", svc),
            auto_url: get_setting("-getautoproxyurl", svc),
            auto_state: get_setting("-getautoproxystate", svc),
        });
    }

    let backup = ProxyBackup {
        ts: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs(),
        services: snapshots,
    };

    fs::create_dir_all(figcn_dir())?;
    fs::write(backup_path(), serde_json::to_string_pretty(&backup)?)?;
    println!("💾 已备份当前代理设置");

    // 构建批量命令
    let port_str = port.to_string();
    let mut shell_cmds = Vec::new();
    for svc in &services {
        let q = format!("\"{}\"", svc.replace('"', "\\\""));
        shell_cmds.push(format!("networksetup -setautoproxystate {q} off"));
        shell_cmds.push(format!("networksetup -setwebproxy {q} {host} {port_str}"));
        shell_cmds.push(format!("networksetup -setwebproxystate {q} on"));
        shell_cmds.push(format!(
            "networksetup -setsecurewebproxy {q} {host} {port_str}"
        ));
        shell_cmds.push(format!("networksetup -setsecurewebproxystate {q} on"));
    }

    // 通过 osascript 提权执行
    let joined = shell_cmds.join(" ; ");
    let osa = format!(
        "do shell script \"{}\" with administrator privileges",
        joined.replace('\\', "\\\\").replace('"', "\\\"")
    );

    let status = Command::new("osascript")
        .args(["-e", &osa])
        .status()?;

    if status.success() {
        println!("✅ 系统代理已设置为 {host}:{port_str}");
        Ok(())
    } else {
        anyhow::bail!("设置系统代理失败（用户可能取消了授权）")
    }
}

/// 恢复系统代理
pub fn restore() -> anyhow::Result<()> {
    let bp = backup_path();
    if !bp.exists() {
        anyhow::bail!("未找到代理备份文件，无法恢复");
    }

    let backup: ProxyBackup = serde_json::from_str(&fs::read_to_string(&bp)?)?;
    let services = list_services()?;
    let mut shell_cmds = Vec::new();

    for svc in &services {
        let q = format!("\"{}\"", svc.replace('"', "\\\""));
        let snap = backup.services.iter().find(|s| &s.name == svc);

        if let Some(snap) = snap {
            // 恢复 web proxy
            let web_on = snap.web.contains("Enabled: Yes");
            let web_host = extract_field(&snap.web, "Server");
            let web_port = extract_field(&snap.web, "Port");
            if web_on && !web_host.is_empty() && !web_port.is_empty() {
                shell_cmds.push(format!(
                    "networksetup -setwebproxy {q} {web_host} {web_port}"
                ));
                shell_cmds.push(format!("networksetup -setwebproxystate {q} on"));
            } else {
                shell_cmds.push(format!("networksetup -setwebproxystate {q} off"));
            }

            // 恢复 secure proxy
            let sec_on = snap.sec.contains("Enabled: Yes");
            let sec_host = extract_field(&snap.sec, "Server");
            let sec_port = extract_field(&snap.sec, "Port");
            if sec_on && !sec_host.is_empty() && !sec_port.is_empty() {
                shell_cmds.push(format!(
                    "networksetup -setsecurewebproxy {q} {sec_host} {sec_port}"
                ));
                shell_cmds.push(format!("networksetup -setsecurewebproxystate {q} on"));
            } else {
                shell_cmds.push(format!("networksetup -setsecurewebproxystate {q} off"));
            }

            // 恢复 auto proxy
            let auto_on = snap.auto_state.contains("Yes");
            let auto_url = extract_field(&snap.auto_url, "URL");
            if auto_on && !auto_url.is_empty() {
                let escaped_url = auto_url.replace('"', "\\\"");
                shell_cmds.push(format!(
                    "networksetup -setautoproxyurl {q} \"{escaped_url}\""
                ));
                shell_cmds.push(format!("networksetup -setautoproxystate {q} on"));
            } else {
                shell_cmds.push(format!("networksetup -setautoproxystate {q} off"));
            }
        } else {
            // 未找到备份记录，关闭代理
            shell_cmds.push(format!("networksetup -setwebproxystate {q} off"));
            shell_cmds.push(format!("networksetup -setsecurewebproxystate {q} off"));
            shell_cmds.push(format!("networksetup -setautoproxystate {q} off"));
        }
    }

    if shell_cmds.is_empty() {
        println!("ℹ️  无需恢复");
        return Ok(());
    }

    let joined = shell_cmds.join(" ; ");
    let osa = format!(
        "do shell script \"{}\" with administrator privileges",
        joined.replace('\\', "\\\\").replace('"', "\\\"")
    );

    let status = Command::new("osascript")
        .args(["-e", &osa])
        .status()?;

    if status.success() {
        println!("✅ 系统代理已恢复");
        Ok(())
    } else {
        anyhow::bail!("恢复系统代理失败")
    }
}

/// 查询系统代理状态
pub fn status() -> anyhow::Result<()> {
    let output = Command::new("scutil")
        .arg("--proxy")
        .output()?;
    let stdout = String::from_utf8_lossy(&output.stdout);

    let mut http_enabled = false;
    let mut http_host = String::new();
    let mut http_port = String::new();
    let mut https_enabled = false;
    let mut https_host = String::new();
    let mut https_port = String::new();

    for line in stdout.lines() {
        let trimmed = line.trim();
        if let Some((key, val)) = trimmed.split_once(':') {
            let key = key.trim();
            let val = val.trim();
            match key {
                "HTTPEnable" => http_enabled = val == "1",
                "HTTPProxy" => http_host = val.to_string(),
                "HTTPPort" => http_port = val.to_string(),
                "HTTPSEnable" => https_enabled = val == "1",
                "HTTPSProxy" => https_host = val.to_string(),
                "HTTPSPort" => https_port = val.to_string(),
                _ => {}
            }
        }
    }

    println!("📡 系统代理状态：");
    if http_enabled {
        println!("   HTTP  → {http_host}:{http_port}");
    } else {
        println!("   HTTP  → 关闭");
    }
    if https_enabled {
        println!("   HTTPS → {https_host}:{https_port}");
    } else {
        println!("   HTTPS → 关闭");
    }

    Ok(())
}

fn extract_field(text: &str, field: &str) -> String {
    for line in text.lines() {
        let trimmed = line.trim();
        let prefix = format!("{field}:");
        if let Some(rest) = trimmed.strip_prefix(&prefix) {
            return rest.trim().to_string();
        }
        // 也匹配 "Server: xxx" 格式
        let prefix2 = format!("{field}: ");
        if trimmed.starts_with(&prefix2) {
            return trimmed[prefix2.len()..].trim().to_string();
        }
    }
    String::new()
}
