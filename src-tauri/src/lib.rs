// Xstarz Analysis — desktop shell (Tauri 2).
//
// ARCHITECTURE
// This crate is deliberately thin. It opens a window onto the SAME production
// `dist/` that the browser, Android and iOS all load. There is no
// desktop-specific UI, no desktop-specific router, and no desktop-specific
// decision engine — every recommendation still comes from the protected
// Convex pipeline over the network, exactly as on the other three surfaces.
//
// WHAT THIS SHELL DELIBERATELY DOES NOT DO
//   * It holds no provider API keys. Provider acquisition is server-side only.
//   * It registers no custom commands that read the filesystem, spawn
//     processes, or expose the OS to web content.
//   * It does not bundle a Convex URL; the web layer reads its own build-time
//     configuration, so desktop and web cannot drift apart.

use tauri::Manager;

/// Hosts the desktop shell is allowed to hand to the operating system browser.
///
/// External navigation is the one place a desktop wrapper can introduce an
/// open redirect that the web app's own guards would never see: a link with
/// `target="_blank"` leaves the webview and becomes an OS-level "open this
/// URL" request. Phase 169b hardened in-app redirects; this is the equivalent
/// boundary for the desktop surface.
///
/// Empty by default and intentionally so. Nothing in the product currently
/// needs to open an external site, and an empty allowlist cannot be abused.
/// Adding a host here is a deliberate, reviewable act.
const ALLOWED_EXTERNAL_HOSTS: &[&str] = &[];

/// Decides whether a URL may be opened in the user's real browser.
///
/// Rules, in order:
///   1. Only `https` is ever eligible. `javascript:`, `data:`, `file:` and
///      plain `http:` are rejected outright — the first three are classic
///      code/credential-exfiltration vectors and the fourth is downgradeable.
///   2. The host must appear in `ALLOWED_EXTERNAL_HOSTS` exactly, or be a
///      subdomain of an allowed host. Substring matching is NOT used, because
///      `xstarz.app.evil.com` contains `xstarz.app`.
///   3. Anything embedding credentials (`user:pass@host`) is rejected.
pub fn is_allowed_external_url(raw: &str) -> bool {
    let trimmed = raw.trim();

    // Scheme check before any parsing, so a malformed URL cannot slip through.
    let rest = match trimmed.strip_prefix("https://") {
        Some(r) => r,
        None => return false,
    };

    // Reject embedded credentials and empty authorities.
    let authority = rest.split(['/', '?', '#']).next().unwrap_or("");
    if authority.is_empty() || authority.contains('@') {
        return false;
    }

    // Strip an optional port before comparing.
    let host = authority.split(':').next().unwrap_or("").to_ascii_lowercase();
    if host.is_empty() {
        return false;
    }

    ALLOWED_EXTERNAL_HOSTS.iter().any(|allowed| {
        let allowed = allowed.to_ascii_lowercase();
        host == allowed || host.ends_with(&format!(".{allowed}"))
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // Fail fast and visibly if the window is missing, rather than
            // starting a process with no UI.
            let _window = app
                .get_webview_window("main")
                .expect("main window is declared in tauri.conf.json");
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Xstarz Analysis");
}

#[cfg(test)]
mod tests {
    use super::is_allowed_external_url;

    #[test]
    fn rejects_dangerous_schemes() {
        for url in [
            "javascript:alert(1)",
            "data:text/html,<script>alert(1)</script>",
            "file:///etc/passwd",
            "http://example.com",
            "HTTPS://",
            "",
            "   ",
        ] {
            assert!(!is_allowed_external_url(url), "must reject {url}");
        }
    }

    #[test]
    fn rejects_hosts_outside_the_allowlist() {
        // The allowlist is empty by default, so everything is rejected.
        for url in [
            "https://evil.com",
            "https://xstarz.app.evil.com",
            "https://example.com/download",
        ] {
            assert!(!is_allowed_external_url(url), "must reject {url}");
        }
    }

    #[test]
    fn rejects_embedded_credentials() {
        assert!(!is_allowed_external_url("https://user:pass@example.com"));
    }

    #[test]
    fn rejects_empty_authority() {
        assert!(!is_allowed_external_url("https:///path"));
        assert!(!is_allowed_external_url("https://:8080/path"));
    }
}
