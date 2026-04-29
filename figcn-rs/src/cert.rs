// src/cert.rs
// CA 证书生成、加载、安装

use rcgen::{BasicConstraints, CertificateParams, DistinguishedName, DnType, IsCa, KeyPair, KeyUsagePurpose};
use std::fs;
use std::path::PathBuf;
use std::process::Command;

const CA_CERT_FILENAME: &str = "ca-cert.pem";
const CA_KEY_FILENAME: &str = "ca-key.pem";
const CA_CERT_DER_FILENAME: &str = "ca-cert.cer";

/// 获取 ~/.figcn 目录
pub fn figcn_dir() -> PathBuf {
    let home = dirs::home_dir().expect("无法获取 HOME 目录");
    home.join(".figcn")
}

pub fn cert_path() -> PathBuf {
    figcn_dir().join(CA_CERT_FILENAME)
}

pub fn key_path() -> PathBuf {
    figcn_dir().join(CA_KEY_FILENAME)
}

pub fn cert_der_path() -> PathBuf {
    figcn_dir().join(CA_CERT_DER_FILENAME)
}

/// 生成 CA 证书（如果不存在）
pub fn generate() -> anyhow::Result<(PathBuf, PathBuf)> {
    let dir = figcn_dir();
    fs::create_dir_all(&dir)?;

    let cp = cert_path();
    let kp = key_path();
    let dp = cert_der_path();

    if cp.exists() && kp.exists() {
        println!("✅ CA 证书已存在：{}", cp.display());
        return Ok((cp, kp));
    }

    println!("🔐 正在生成 CA 证书...");

    let mut params = CertificateParams::new(vec!["FigCN CA".to_string()])?;
    params.distinguished_name = DistinguishedName::new();
    params
        .distinguished_name
        .push(DnType::CommonName, "FigCN CA");
    params
        .distinguished_name
        .push(DnType::OrganizationName, "FigCN");
    params.is_ca = IsCa::Ca(BasicConstraints::Unconstrained);
    params.key_usages = vec![
        KeyUsagePurpose::DigitalSignature,
        KeyUsagePurpose::KeyCertSign,
        KeyUsagePurpose::CrlSign,
    ];

    let key_pair = KeyPair::generate()?;
    let cert = params.self_signed(&key_pair)?;

    // 写 PEM 格式
    fs::write(&cp, cert.pem())?;
    fs::write(&kp, key_pair.serialize_pem())?;

    // 写 DER 格式（用于安装到钥匙串）
    fs::write(&dp, cert.der())?;

    println!("✅ CA 证书已生成：");
    println!("   证书：{}", cp.display());
    println!("   私钥：{}", kp.display());
    println!("   DER： {}", dp.display());

    Ok((cp, kp))
}

/// 加载已有的 CA 证书和私钥（PEM 格式）
pub fn load() -> anyhow::Result<(String, String)> {
    let cp = cert_path();
    let kp = key_path();

    if !cp.exists() || !kp.exists() {
        anyhow::bail!(
            "CA 证书不存在，请先运行 `figcn cert generate`\n  期望路径：{}",
            cp.display()
        );
    }

    let cert_pem = fs::read_to_string(&cp)?;
    let key_pem = fs::read_to_string(&kp)?;

    Ok((cert_pem, key_pem))
}

/// 安装证书到 macOS System keychain
pub fn install() -> anyhow::Result<()> {
    let dp = cert_der_path();
    if !dp.exists() {
        // 尝试 PEM
        let cp = cert_path();
        if !cp.exists() {
            anyhow::bail!("证书不存在，请先运行 `figcn cert generate`");
        }
        // 用 PEM 安装
        return install_cert_file(&cp);
    }
    install_cert_file(&dp)
}

fn install_cert_file(cert_file: &PathBuf) -> anyhow::Result<()> {
    println!("🔑 正在安装 CA 证书到系统钥匙串...");
    println!("   文件：{}", cert_file.display());

    // 先尝试安装到 login keychain
    let login_result = Command::new("security")
        .args([
            "add-trusted-cert",
            "-d",
            "-r",
            "trustRoot",
            "-k",
        ])
        .arg(
            dirs::home_dir()
                .unwrap()
                .join("Library/Keychains/login.keychain-db"),
        )
        .arg(cert_file)
        .output();

    if let Ok(output) = &login_result {
        if output.status.success() {
            println!("✅ 证书已安装到 login keychain 并设为受信任根。");
            return Ok(());
        }
    }

    // 回退到 System keychain（需要 sudo）
    println!("⚠️  login keychain 安装失败，尝试 System keychain（需要管理员密码）...");

    let status = Command::new("sudo")
        .args([
            "security",
            "add-trusted-cert",
            "-d",
            "-r",
            "trustRoot",
            "-k",
            "/Library/Keychains/System.keychain",
        ])
        .arg(cert_file)
        .status()?;

    if status.success() {
        println!("✅ 证书已安装到 System keychain。");
        Ok(())
    } else {
        eprintln!("❌ 自动安装失败。请手动操作：");
        eprintln!("   1. 打开「钥匙串访问」(Keychain Access)");
        eprintln!("   2. 导入 {}", cert_file.display());
        eprintln!("   3. 双击证书 → 信任 → 始终信任");
        anyhow::bail!("证书安装失败")
    }
}

/// 打印证书路径
pub fn print_paths() {
    println!("证书目录：{}", figcn_dir().display());
    println!("CA 证书 (PEM)：{}", cert_path().display());
    println!("CA 私钥 (PEM)：{}", key_path().display());
    println!("CA 证书 (DER)：{}", cert_der_path().display());

    if cert_path().exists() {
        println!("状态：✅ 已生成");
    } else {
        println!("状态：❌ 未生成（运行 `figcn cert generate`）");
    }
}
