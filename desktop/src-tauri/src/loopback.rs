use std::sync::Arc;
use std::time::Duration;

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use url::Url;

use crate::session::Session;

const OK_PAGE: &str = "You're signed in. You can return to Klei Bridal.";
const FAILED_PAGE: &str = "Sign-in didn't finish. Return to Klei Bridal and try again.";

/// Fallback redirect target where the `klei` scheme cannot be registered (spike S-2). Answers until the one
/// /callback request arrives, then closes. Empty speculative browser connections and stray paths do not count.
pub async fn serve(listener: TcpListener, session: Arc<Session>) {
    while let Ok((mut sock, _)) = listener.accept().await {
        let Some(target) = read_target(&mut sock).await else { continue };
        match Url::parse(&format!("http://127.0.0.1{target}")) {
            Ok(url) if url.path() == "/callback" => {
                let ok = session.complete(&url).await.is_ok();
                respond(&mut sock, 200, if ok { OK_PAGE } else { FAILED_PAGE }).await;
                return;
            }
            _ => respond(&mut sock, 404, "Not found").await,
        }
    }
}

async fn read_target(sock: &mut TcpStream) -> Option<String> {
    let mut buf = Vec::with_capacity(1024);
    let read = async {
        let mut chunk = [0u8; 1024];
        while buf.len() < 8192 && !buf.windows(4).any(|w| w == b"\r\n\r\n") {
            match sock.read(&mut chunk).await {
                Ok(0) | Err(_) => return false,
                Ok(n) => buf.extend_from_slice(&chunk[..n]),
            }
        }
        true
    };
    if !matches!(tokio::time::timeout(Duration::from_secs(5), read).await, Ok(true)) {
        return None;
    }
    let head = String::from_utf8_lossy(&buf);
    let mut parts = head.lines().next()?.split(' ');
    (parts.next()? == "GET").then(|| parts.next().map(str::to_owned))?
}

async fn respond(sock: &mut TcpStream, status: u16, text: &str) {
    let html = format!("<!doctype html><meta charset=utf-8><title>Klei Bridal</title><p>{text}</p>");
    let head = format!(
        "HTTP/1.1 {status} X\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nCache-Control: no-store\r\nContent-Security-Policy: default-src 'none'\r\nConnection: close\r\n\r\n",
        html.len()
    );
    let _ = sock.write_all(head.as_bytes()).await;
    let _ = sock.write_all(html.as_bytes()).await;
    let _ = sock.shutdown().await;
}
