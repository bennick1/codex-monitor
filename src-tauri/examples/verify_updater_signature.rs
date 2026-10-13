//! 发布前按官方 Tauri updater 格式验证安装包与预期公钥是否匹配。
use base64::{engine::general_purpose::STANDARD, Engine};
use minisign_verify::{PublicKey, Signature};

fn verify(data: &[u8], signature: &str, public_key: &str) -> Result<(), &'static str> {
    let public_key = STANDARD
        .decode(public_key.trim())
        .map_err(|_| "公钥编码无效")?;
    let public_key = std::str::from_utf8(&public_key).map_err(|_| "公钥格式无效")?;
    let public_key = PublicKey::decode(public_key).map_err(|_| "公钥格式无效")?;
    let signature = STANDARD
        .decode(signature.trim())
        .map_err(|_| "签名编码无效")?;
    let signature = std::str::from_utf8(&signature).map_err(|_| "签名格式无效")?;
    let signature = Signature::decode(signature).map_err(|_| "签名格式无效")?;
    public_key
        .verify(data, &signature, true)
        .map_err(|_| "安装包签名与预期公钥不匹配")
}

fn run() -> Result<(), &'static str> {
    let args: Vec<_> = std::env::args_os().skip(1).collect();
    if !(2..=3).contains(&args.len()) {
        return Err("用法：verify_updater_signature artifact signature-file [public-key]");
    }
    let public_key = std::env::var("CODEX_MONITOR_UPDATER_PUBLIC_KEY")
        .ok()
        .or_else(|| {
            args.get(2)
                .and_then(|value| value.to_str())
                .map(String::from)
        })
        .filter(|key| !key.trim().is_empty())
        .ok_or("未设置预期更新公钥")?;
    let data = std::fs::read(&args[0]).map_err(|_| "无法读取安装包")?;
    let signature = std::fs::read_to_string(&args[1]).map_err(|_| "无法读取签名文件")?;
    verify(&data, &signature, &public_key)
}

fn main() {
    if let Err(error) = run() {
        eprintln!("{error}");
        std::process::exit(1);
    }
    println!("安装包签名已通过预期公钥验证");
}

#[cfg(test)]
mod tests {
    use super::*;
    // minisign-verify 0.2.5 的公开测试向量，无任何私钥。
    const KEY: &str = "RWQf6LRCGA9i53mlYecO4IzT51TGPpvWucNSCh1CBM0QTaLn73Y7GFO3";
    const SIG: &str = "untrusted comment: signature from minisign secret key\nRWQf6LRCGA9i59SLOFxz6NxvASXDJeRtuZykwQepbDEGt87ig1BNpWaVWuNrm73YiIiJbq71Wi+dP9eKL8OC351vwIasSSbXxwA=\ntrusted comment: timestamp:1555779966\tfile:test\nQtKMXWyYcwdpZAlPF7tE2ENJkRd1ujvKjlj1m9RtHTBnZPa5WKU5uWRs5GoP5M/VqE81QFuMKI5k/SfNQUaOAA==";
    #[test]
    fn original_bytes_verify_and_wrong_key_signature_or_bytes_fail() {
        let key = STANDARD.encode(format!("untrusted comment: public fixture\n{KEY}"));
        let signature = STANDARD.encode(SIG);
        assert!(verify(b"test", &signature, &key).is_ok());
        assert!(verify(b"Test", &signature, &key).is_err());
        let mut wrong_key = STANDARD.decode(KEY).unwrap();
        wrong_key[10] ^= 1;
        let wrong_key = STANDARD.encode(format!(
            "untrusted comment: public fixture\n{}",
            STANDARD.encode(wrong_key)
        ));
        assert!(verify(b"test", &signature, &wrong_key).is_err());
        let wrong_signature = STANDARD.encode(SIG.replace("RWQf6", "RWQf7"));
        assert!(verify(b"test", &wrong_signature, &key).is_err());
    }
}
