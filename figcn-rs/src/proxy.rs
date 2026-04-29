// src/proxy.rs
// MITM 代理 + Figma 语言包 URL 重写

use hudsucker::{
    certificate_authority::RcgenAuthority,
    hyper::{Request, Response},
    rcgen::{Issuer, KeyPair},
    rustls::crypto::aws_lc_rs,
    Body, HttpContext, HttpHandler, RequestOrResponse,
};
use http_body_util::Full;
use hyper::body::Bytes;
use regex::Regex;
use std::sync::Arc;
use tracing::{debug, info};

use crate::cert;

/// 一条 URL 重写规则
struct RewriteRule {
    host: &'static str,
    pattern: Regex,
    replace_url: &'static str,
}

/// 构建所有重写规则（与原 figcn_injector.py 完全一致）
fn build_rules() -> Vec<RewriteRule> {
    vec![
        RewriteRule {
            host: "www.figma.com",
            pattern: Regex::new(
                r"^/webpack-artifacts/assets/figma_app(?:_beta|__react_profile)?(?:__rspack)?-[a-f0-9]+\.min\.en\.json(?:\.br)?$"
            ).unwrap(),
            replace_url: "https://kailous.github.io/figma-zh-CN-localized/lang/zh.json",
        },
        RewriteRule {
            host: "www.figma.com",
            pattern: Regex::new(
                r"^/webpack-artifacts/assets/auth_iframe(?:__rspack)?-[a-f0-9]+\.min\.en\.json(?:\.br)?$"
            ).unwrap(),
            replace_url: "https://kailous.github.io/figma-zh-CN-localized/lang/auth_iframe-zh.json",
        },
        RewriteRule {
            host: "www.figma.com",
            pattern: Regex::new(
                r"^/webpack-artifacts/assets/community(?:__rspack)?-[a-f0-9]+\.min\.en\.json(?:\.br)?$"
            ).unwrap(),
            replace_url: "https://kailous.github.io/figma-zh-CN-localized/lang/community-zh.json",
        },
    ]
}

/// FigCN 请求处理器
#[derive(Clone)]
struct FigCNHandler {
    rules: Arc<Vec<RewriteRule>>,
    client: reqwest::Client,
}

impl HttpHandler for FigCNHandler {
    async fn handle_request(
        &mut self,
        _ctx: &HttpContext,
        req: Request<Body>,
    ) -> RequestOrResponse {
        let host = req.uri().host().unwrap_or("").to_lowercase();
        let path = req.uri().path();

        // 只处理 figma.com 的 webpack-artifacts 路径
        if host != "www.figma.com" || !path.starts_with("/webpack-artifacts/assets/") {
            return RequestOrResponse::Request(req);
        }

        // 匹配重写规则
        for rule in self.rules.iter() {
            if host == rule.host && rule.pattern.is_match(path) {
                let old_url = req.uri().to_string();
                info!("🎯 命中：{} → {}", old_url, rule.replace_url);

                // 从 GitHub Pages 获取中文语言包
                match self.client.get(rule.replace_url).send().await {
                    Ok(resp) => {
                        let status = resp.status();
                        let headers = resp.headers().clone();
                        match resp.bytes().await {
                            Ok(body) => {
                                let mut builder =
                                    Response::builder().status(status.as_u16());
                                // 透传关键 headers
                                for (key, val) in headers.iter() {
                                    if key == "content-type"
                                        || key == "cache-control"
                                        || key == "etag"
                                        || key == "last-modified"
                                    {
                                        builder = builder.header(key, val);
                                    }
                                }
                                // 确保 content-type 存在
                                builder = builder.header(
                                    "content-type",
                                    "application/json; charset=utf-8",
                                );
                                // 标记来源（用于 curl 测试）
                                builder = builder.header("server", "GitHub.com");
                                builder = builder.header("x-figcn", "replaced");

                                let full_body = Full::new(Bytes::from(body.to_vec()));
                                match builder.body(Body::from(full_body)) {
                                    Ok(response) => {
                                        return RequestOrResponse::Response(response)
                                    }
                                    Err(e) => {
                                        tracing::error!("构建响应失败：{}", e);
                                    }
                                }
                            }
                            Err(e) => {
                                tracing::error!("读取响应体失败：{}", e);
                            }
                        }
                    }
                    Err(e) => {
                        tracing::error!("获取中文语言包失败：{}", e);
                    }
                }
            }
        }

        // 不匹配或获取失败：透传原始请求
        debug!("透传：{}", req.uri());
        RequestOrResponse::Request(req)
    }

    async fn handle_response(
        &mut self,
        _ctx: &HttpContext,
        res: Response<Body>,
    ) -> Response<Body> {
        res
    }
}

/// 启动 MITM 代理
pub async fn start(host: &str, port: u16, upstream: Option<&str>) -> anyhow::Result<()> {
    // 加载 CA
    let (cert_pem, key_pem) = cert::load()?;

    // 使用 rcgen::Issuer 从 PEM 加载
    let key_pair = KeyPair::from_pem(&key_pem)
        .map_err(|e| anyhow::anyhow!("解析 CA 私钥失败：{}", e))?;
    let issuer = Issuer::from_ca_cert_pem(&cert_pem, key_pair)
        .map_err(|e| anyhow::anyhow!("解析 CA 证书失败：{}", e))?;

    let ca = RcgenAuthority::new(issuer, 1_000, aws_lc_rs::default_provider());

    let addr = format!("{host}:{port}");

    // 构建 reqwest 客户端（用于获取 GitHub Pages 上的翻译文件）
    let mut client_builder = reqwest::Client::builder()
        .danger_accept_invalid_certs(false)
        .redirect(reqwest::redirect::Policy::limited(5));

    // 如果有上游代理，让 reqwest 也通过上游
    if let Some(up) = upstream {
        let proxy = reqwest::Proxy::all(up)?;
        client_builder = client_builder.proxy(proxy);
        info!("📡 上游代理：{}", up);
    }

    let client = client_builder.build()?;

    let handler = FigCNHandler {
        rules: Arc::new(build_rules()),
        client,
    };

    println!("🚀 FigCN 代理已启动");
    println!("   监听地址：{addr}");
    if let Some(up) = upstream {
        println!("   上游代理：{up}");
    }
    println!("   按 Ctrl+C 停止\n");

    let proxy = hudsucker::Proxy::builder()
        .with_addr(addr.parse()?)
        .with_ca(ca)
        .with_rustls_connector(aws_lc_rs::default_provider())
        .with_http_handler(handler)
        .with_graceful_shutdown(shutdown_signal())
        .build()?;

    proxy.start().await?;

    println!("\n🛑 代理已停止");
    Ok(())
}

/// 优雅关闭信号 — 监听 SIGINT(Ctrl+C)、SIGTERM(kill)、SIGHUP(Terminal关闭)
async fn shutdown_signal() {
    use tokio::signal::unix::{signal, SignalKind};

    let mut sigterm = signal(SignalKind::terminate()).expect("安装 SIGTERM 处理器失败");
    let mut sighup = signal(SignalKind::hangup()).expect("安装 SIGHUP 处理器失败");

    tokio::select! {
        _ = tokio::signal::ctrl_c() => {
            println!("\n⏹  收到 Ctrl+C，正在关闭...");
        }
        _ = sigterm.recv() => {
            println!("\n⏹  收到 SIGTERM，正在关闭...");
        }
        _ = sighup.recv() => {
            println!("\n⏹  收到 SIGHUP（终端关闭），正在关闭...");
        }
    }
}
