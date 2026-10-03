//! The planning coach's one conversation with the outside world. Six is offline unless
//! this is switched on in Settings, and even then nothing leaves the Mac until the user
//! presses "Check the list": then the titles of that list go to TypeSafe, once.
//!
//! No HTTP client is linked into Six. The request is made by the `curl` that ships with
//! macOS, and the key is read by the `security` tool from the login Keychain, where the
//! user put it. The key and the request reach curl through a pipe: neither is ever on a
//! command line, in a file, or in a log.

use std::io::Write;
use std::process::{Command, Stdio};

use serde_json::Value;

const ENDPOINT: &str = "https://api.typesafe.ai/v1/systemone";
/// The Keychain item every TypeSafe tool on this Mac reads.
const KEYCHAIN_SERVICE: &str = "typesafe-api-key";
const TIMEOUT_SECS: &str = "20";

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CoachError {
    NoKey,
    Unreachable(String),
    Refused,
    Busy,
    Failed(String),
}

impl CoachError {
    pub fn code(&self) -> &'static str {
        match self {
            CoachError::NoKey => "coach_no_key",
            CoachError::Unreachable(_) => "coach_unreachable",
            CoachError::Refused => "coach_refused",
            CoachError::Busy => "coach_busy",
            CoachError::Failed(_) => "coach_failed",
        }
    }

    /// A sentence for the planner. Nothing was changed by a failed check.
    pub fn message(&self) -> String {
        match self {
            CoachError::NoKey => "No TypeSafe key in the Keychain. Nothing was sent.".to_string(),
            CoachError::Unreachable(_) => "TypeSafe could not be reached. The list is as you left it.".to_string(),
            CoachError::Refused => "TypeSafe did not accept the key. The list is as you left it.".to_string(),
            CoachError::Busy => "TypeSafe is busy. Try again in a minute.".to_string(),
            CoachError::Failed(_) => "The check did not work. The list is as you left it.".to_string(),
        }
    }
}

fn security(read_secret: bool) -> Command {
    let mut cmd = Command::new("/usr/bin/security");
    cmd.arg("find-generic-password").args(["-s", KEYCHAIN_SERVICE]);
    if let Ok(user) = std::env::var("USER") {
        if !user.is_empty() {
            cmd.args(["-a", &user]);
        }
    }
    if read_secret {
        cmd.arg("-w");
    }
    cmd.stdin(Stdio::null());
    cmd
}

/// Whether a key is in the Keychain. Does not read it.
pub fn key_present() -> bool {
    security(false)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .is_ok_and(|s| s.success())
}

fn read_key() -> Result<String, CoachError> {
    let out = security(true)
        .stderr(Stdio::null())
        .output()
        .map_err(|_| CoachError::NoKey)?;
    let key = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if !out.status.success() || key.is_empty() {
        return Err(CoachError::NoKey);
    }
    Ok(key)
}

/// A value inside a curl config file's double quotes.
fn quoted(value: &str) -> String {
    let mut out = String::with_capacity(value.len() + 8);
    for c in value.chars() {
        match c {
            '\\' => out.push_str("\\\\"),
            '"' => out.push_str("\\\""),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            other => out.push(other),
        }
    }
    out
}

/// What curl reads from its standard input: the key and the body, never on a command line.
pub fn curl_config(key: &str, body: &str) -> String {
    format!(
        "header = \"Authorization: Bearer {}\"\nheader = \"Content-Type: application/json\"\ndata-binary = \"{}\"\n",
        quoted(key),
        quoted(body)
    )
}

/// curl prints the response body, then a newline and the HTTP status (`--write-out`).
pub fn split_output(output: &str) -> Option<(u16, &str)> {
    let (body, status) = output.rsplit_once('\n')?;
    Some((status.trim().parse().ok()?, body))
}

fn call(config: &str) -> Result<(u16, String), CoachError> {
    let mut child = Command::new("/usr/bin/curl")
        // Nothing inherited: a proxy or a certificate bundle named in Six's environment
        // must not carry the key and the titles somewhere else.
        .env_clear()
        // First, so no curlrc of the user's changes what this does.
        .arg("--disable")
        .args(["--silent", "--show-error", "--proto", "=https", "--max-time", TIMEOUT_SECS])
        .args(["--config", "-", "--write-out", "\n%{http_code}", ENDPOINT])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| CoachError::Unreachable(e.to_string()))?;
    if let Some(mut stdin) = child.stdin.take() {
        // Dropping the handle closes the pipe, which is how curl knows the config is whole.
        stdin
            .write_all(config.as_bytes())
            .map_err(|e| CoachError::Unreachable(e.to_string()))?;
    }
    let out = child
        .wait_with_output()
        .map_err(|e| CoachError::Unreachable(e.to_string()))?;
    if !out.status.success() {
        return Err(CoachError::Unreachable(
            String::from_utf8_lossy(&out.stderr).trim().chars().take(200).collect(),
        ));
    }
    let text = String::from_utf8_lossy(&out.stdout);
    let (status, body) = split_output(&text).ok_or_else(|| CoachError::Failed("no status".to_string()))?;
    Ok((status, body.to_string()))
}

/// Ask TypeSafe, once. Blocking: call it off the async runtime's threads. Returns the
/// `answers` map. Nothing is retried: one press sends the titles one time, and a busy
/// service is reported so the user can press again.
pub fn ask(request: &Value) -> Result<Value, CoachError> {
    let key = read_key()?;
    let config = curl_config(&key, &request.to_string());
    drop(key);
    let (status, body) = call(&config)?;
    match status {
        200 => serde_json::from_str::<Value>(&body)
            .ok()
            .and_then(|v| v.get("answers").cloned())
            .ok_or_else(|| CoachError::Failed("unreadable answer".to_string())),
        401 | 403 => Err(CoachError::Refused),
        429 | 529 => Err(CoachError::Busy),
        other => Err(CoachError::Failed(format!("HTTP {other}"))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_key_and_the_body_are_quoted_for_curl() {
        let config = curl_config("ab\"c\\d", r#"{"title":"say \"hi\"\n"}"#);
        let lines: Vec<&str> = config.lines().collect();
        assert_eq!(lines.len(), 3, "one option per line, whatever the body holds");
        assert_eq!(lines[0], r#"header = "Authorization: Bearer ab\"c\\d""#);
        assert_eq!(lines[1], r#"header = "Content-Type: application/json""#);
        assert_eq!(lines[2], r#"data-binary = "{\"title\":\"say \\\"hi\\\"\\n\"}""#);
        // A raw newline or tab in a value cannot break out of its line.
        let odd = curl_config("k", "a\nb\tc\rd");
        assert_eq!(odd.lines().count(), 3);
        assert!(odd.contains(r#"data-binary = "a\nb\tc\rd""#));
    }

    #[test]
    fn the_status_is_the_last_line_of_what_curl_prints() {
        assert_eq!(split_output("{\"answers\":{}}\n200"), Some((200, "{\"answers\":{}}")));
        assert_eq!(split_output("line one\nline two\n429"), Some((429, "line one\nline two")));
        assert_eq!(split_output("\n401"), Some((401, "")));
        assert_eq!(split_output("no status here"), None);
        assert_eq!(split_output("body\nnot-a-number"), None);
    }

    /// Live, so not part of the ordinary run: needs a TypeSafe key in the Keychain and
    /// the network, and sends six made-up titles. `cargo test -- --ignored live_`
    #[test]
    #[ignore]
    fn live_a_made_up_list_gets_the_hints_a_reader_would_give() {
        use crate::domain::coach::{hints, request, Hint};
        let titles: Vec<String> = [
            "Send the Q3 numbers to Priya",
            "Rewrite the onboarding flow end to end",
            "Clean up the vendor list and decide whether to merge it with the CRM",
            "Work on the website",
            "Book the dentist",
            "Send Maya the accounts list and the statements",
        ]
        .iter()
        .map(|t| (*t).to_string())
        .collect();
        let answers = ask(&request(&titles)).expect("TypeSafe answered");
        let got = hints(titles.len(), &answers);
        eprintln!("{got:?}");
        assert_eq!(got[0], None);
        assert_eq!(got[1], Some(Hint::MostOfADay));
        assert_eq!(got[2], Some(Hint::TwoTasks));
        assert_eq!(got[3], Some(Hint::NoFinish));
        assert_eq!(got[4], None);
        assert_eq!(got[5], None, "one action over two objects is one task");
    }

    /// Live: a key TypeSafe does not know is refused, and says so plainly.
    #[test]
    #[ignore]
    fn live_a_wrong_key_is_refused() {
        let body = crate::domain::coach::request(&["Book the dentist".to_string()]).to_string();
        let (status, _) = call(&curl_config("not-a-real-key", &body)).expect("curl ran");
        assert_eq!(status, 401);
    }

    #[test]
    fn every_failure_has_a_code_and_a_sentence_that_promises_nothing_changed() {
        for e in [
            CoachError::NoKey,
            CoachError::Unreachable("x".into()),
            CoachError::Refused,
            CoachError::Busy,
            CoachError::Failed("x".into()),
        ] {
            assert!(e.code().starts_with("coach_"));
            assert!(e.message().ends_with('.'));
            assert!(!e.message().contains('x'), "no raw detail reaches the page");
        }
    }
}
