// src/main.rs
// FigCN — Figma 汉化代理 (Rust)

mod cache;
mod cert;
mod proxy;
mod sysproxy;
mod upstream;

use clap::{Parser, Subcommand};
use std::fs;
use std::process::Command;

#[derive(Parser)]
#[command(
    name = "figcn",
    version,
    about = "FigCN — Figma 汉化代理（Rust 版）",
    long_about = "通过本地 MITM 代理将 Figma 英文界面替换为中文。\n\n用法示例：\n  figcn cert generate    # 首次使用：生成 CA 证书\n  figcn cert install     # 首次使用：安装证书到系统\n  figcn start            # 启动代理\n  figcn start --upstream http://127.0.0.1:7890  # 通过 Clash 上游\n  figcn stop             # 停止后台代理\n  figcn cache clear      # 清理 Figma 缓存"
)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// 启动代理
    Start {
        /// 监听地址
        #[arg(long, default_value = "127.0.0.1")]
        host: String,

        /// 监听端口
        #[arg(short, long, default_value_t = 8080)]
        port: u16,

        /// 上游代理地址（如 http://127.0.0.1:7890）
        #[arg(short, long)]
        upstream: Option<String>,

        /// 不自动设置系统代理
        #[arg(long, default_value_t = false)]
        no_sys_proxy: bool,
    },

    /// 停止正在运行的代理
    Stop,

    /// 查看运行状态
    Status,

    /// 证书管理
    Cert {
        #[command(subcommand)]
        action: CertAction,
    },

    /// 系统代理管理
    Proxy {
        #[command(subcommand)]
        action: ProxyAction,
    },

    /// 清理 Figma 缓存
    Cache {
        #[command(subcommand)]
        action: CacheAction,
    },
}

#[derive(Subcommand)]
enum CertAction {
    /// 生成 CA 证书
    Generate,
    /// 安装证书到系统钥匙串
    Install,
    /// 显示证书路径
    Path,
}

#[derive(Subcommand)]
enum ProxyAction {
    /// 设置系统代理指向 FigCN
    Set {
        #[arg(long, default_value = "127.0.0.1")]
        host: String,
        #[arg(short, long, default_value_t = 8080)]
        port: u16,
    },
    /// 恢复系统代理
    Restore,
    /// 查看系统代理状态
    Status,
}

#[derive(Subcommand)]
enum CacheAction {
    /// 清理 Figma 缓存
    Clear,
}

// ── PID 文件管理 ──────────────────────────────────

fn pid_path() -> std::path::PathBuf {
    cert::figcn_dir().join("figcn.pid")
}

/// 写入当前进程 PID
fn write_pid() {
    let dir = cert::figcn_dir();
    let _ = fs::create_dir_all(&dir);
    let _ = fs::write(pid_path(), std::process::id().to_string());
}

/// 删除 PID 文件
fn remove_pid() {
    let _ = fs::remove_file(pid_path());
}

/// 读取已存储的 PID
fn read_pid() -> Option<u32> {
    fs::read_to_string(pid_path())
        .ok()
        .and_then(|s| s.trim().parse().ok())
}

/// 检查指定 PID 的进程是否存活
fn is_pid_alive(pid: u32) -> bool {
    Command::new("kill")
        .args(["-0", &pid.to_string()])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// 停止正在运行的代理（发 SIGTERM）
fn stop_running() -> anyhow::Result<()> {
    match read_pid() {
        Some(pid) if is_pid_alive(pid) => {
            println!("🛑 正在停止 FigCN 代理 (PID {pid})...");
            let status = Command::new("kill")
                .args(["-TERM", &pid.to_string()])
                .status()?;
            if status.success() {
                // 等待进程退出（最多 5 秒）
                for i in 0..50 {
                    if !is_pid_alive(pid) {
                        remove_pid();
                        println!("✅ 代理已停止。");
                        return Ok(());
                    }
                    std::thread::sleep(std::time::Duration::from_millis(100));
                    if i == 10 {
                        println!("   等待进程退出...");
                    }
                }
                // 超时，强制 kill
                eprintln!("⚠️  进程未响应 SIGTERM，发送 SIGKILL...");
                let _ = Command::new("kill")
                    .args(["-9", &pid.to_string()])
                    .status();
                remove_pid();
                // 兜底恢复系统代理
                let _ = sysproxy::restore();
                println!("✅ 代理已强制停止，系统代理已恢复。");
            } else {
                anyhow::bail!("发送停止信号失败");
            }
            Ok(())
        }
        Some(pid) => {
            println!("ℹ️  PID {pid} 已不存在，清理残留...");
            remove_pid();
            // 兜底恢复系统代理
            let _ = sysproxy::restore();
            println!("✅ 已清理。");
            Ok(())
        }
        None => {
            println!("ℹ️  没有正在运行的 FigCN 代理。");
            Ok(())
        }
    }
}

/// 清理上次异常退出残留的代理设置
fn cleanup_stale() {
    if let Some(pid) = read_pid() {
        if !is_pid_alive(pid) {
            eprintln!("⚠️  检测到上次异常退出（PID {pid} 已失效）");
            eprintln!("   正在自动恢复系统代理...");
            let _ = sysproxy::restore();
            remove_pid();
            eprintln!("✅ 已恢复。\n");
        }
    }
}

// ── 主入口 ──────────────────────────────────────────

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // 初始化日志
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .with_target(false)
        .without_time()
        .init();

    let cli = Cli::parse();

    match cli.command {
        Commands::Start {
            host,
            port,
            upstream,
            no_sys_proxy,
        } => {
            // 1. 清理上次异常退出的残留
            cleanup_stale();

            // 2. 检查是否已经有实例在运行
            if let Some(pid) = read_pid() {
                if is_pid_alive(pid) {
                    eprintln!("❌ FigCN 代理已在运行 (PID {pid})");
                    eprintln!("   运行 `figcn stop` 先停止，或 `figcn status` 查看状态。");
                    return Ok(());
                }
            }

            // 3. 确保证书存在
            if !cert::cert_path().exists() {
                println!("⚠️  CA 证书不存在，正在自动生成...");
                cert::generate()?;
                println!();
                println!("🔑 请安装证书到系统钥匙串：");
                println!("   figcn cert install");
                println!();
                println!("   安装后重新运行 `figcn start`");
                return Ok(());
            }

            // 4. 自动检测上游代理（如果用户没有手动指定）
            let effective_upstream = if upstream.is_some() {
                println!("📡 使用指定的上游代理：{}", upstream.as_deref().unwrap());
                upstream
            } else {
                let detected = upstream::detect();
                upstream::print_detect_info(&detected);
                detected.map(|r| r.addr)
            };
            println!();

            // 5. 写入 PID
            write_pid();

            // 6. 自动设置系统代理
            if !no_sys_proxy {
                println!("📡 正在设置系统代理...");
                match sysproxy::set(&host, port) {
                    Ok(()) => {}
                    Err(e) => {
                        eprintln!("⚠️  设置系统代理失败：{e}");
                        eprintln!("   可手动设置或使用 --no-sys-proxy 跳过");
                    }
                }
                println!();
            }

            // 7. 启动代理（阻塞直到信号退出）
            let result = proxy::start(&host, port, effective_upstream.as_deref()).await;

            // 8. 清理：无论如何都恢复代理并删除 PID
            if !no_sys_proxy {
                println!("📡 正在恢复系统代理...");
                if let Err(e) = sysproxy::restore() {
                    eprintln!("⚠️  恢复系统代理失败：{e}");
                    eprintln!("   可手动运行：figcn proxy restore");
                }
            }
            remove_pid();

            result
        }

        Commands::Stop => stop_running(),

        Commands::Status => {
            match read_pid() {
                Some(pid) if is_pid_alive(pid) => {
                    println!("✅ FigCN 代理正在运行 (PID {pid})");
                }
                Some(pid) => {
                    println!("⚠️  PID 文件存在 ({pid})，但进程已不在。");
                    println!("   可能上次异常退出，运行 `figcn stop` 清理。");
                }
                None => {
                    println!("⏹  FigCN 代理未在运行。");
                }
            }
            sysproxy::status()
        }

        Commands::Cert { action } => match action {
            CertAction::Generate => {
                cert::generate()?;
                Ok(())
            }
            CertAction::Install => cert::install(),
            CertAction::Path => {
                cert::print_paths();
                Ok(())
            }
        },

        Commands::Proxy { action } => match action {
            ProxyAction::Set { host, port } => sysproxy::set(&host, port),
            ProxyAction::Restore => sysproxy::restore(),
            ProxyAction::Status => sysproxy::status(),
        },

        Commands::Cache { action } => match action {
            CacheAction::Clear => cache::clear(),
        },
    }
}
