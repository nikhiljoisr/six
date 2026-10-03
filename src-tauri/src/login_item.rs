//! The login item behind Settings → "Open Six at login": a LaunchAgent that records where
//! Six was when the switch was set. If that app has since been moved or replaced, the
//! item points at nothing; it is then pointed at the Six that is running. It is never
//! repointed while the app it names still exists, so trying another build of Six (a
//! development bundle, a copy opened from a download) cannot take the login item over.

/// The LaunchAgent's label and file name (`~/Library/LaunchAgents/<label>.plist`).
pub const LABEL: &str = "com.nikhiljois.six";

/// The program the plist starts: the first string of its `ProgramArguments`.
pub fn recorded_program(plist: &str) -> Option<String> {
    let after = plist.split_once("<key>ProgramArguments</key>")?.1;
    let start = after.find("<string>")? + "<string>".len();
    let end = after[start..].find("</string>")? + start;
    let raw = after[start..end].trim();
    if raw.is_empty() {
        return None;
    }
    Some(
        raw.replace("&lt;", "<")
            .replace("&gt;", ">")
            .replace("&quot;", "\"")
            .replace("&apos;", "'")
            .replace("&amp;", "&"),
    )
}

/// Whether to point the login item at the running Six: only when the program it names is
/// gone, and only from a real, settled app bundle (macOS runs a quarantined download from
/// a temporary "AppTranslocation" path, which must never be recorded).
pub fn should_repoint(recorded: Option<&str>, recorded_exists: bool, current_exe: &str, in_app_bundle: bool) -> bool {
    recorded.is_some() && !recorded_exists && in_app_bundle && !current_exe.contains("/AppTranslocation/")
}

#[cfg(test)]
mod tests {
    use super::*;

    const PLIST: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
  <dict>
  <key>Label</key>
  <string>com.nikhiljois.six</string>
  <key>ProgramArguments</key>
  <array><string>/Applications/Six.app/Contents/MacOS/six</string><string>--hidden</string></array>
  <key>RunAtLoad</key>
  <true/>
  </dict>
</plist>"#;

    #[test]
    fn the_program_is_the_first_argument_not_the_label() {
        assert_eq!(recorded_program(PLIST).as_deref(), Some("/Applications/Six.app/Contents/MacOS/six"));
        let amp = PLIST.replace("/Applications/Six.app", "/Users/a/R&amp;D/Six.app");
        assert_eq!(recorded_program(&amp).as_deref(), Some("/Users/a/R&D/Six.app/Contents/MacOS/six"));
        assert_eq!(recorded_program("not a plist"), None);
        assert_eq!(recorded_program("<key>ProgramArguments</key><array></array>"), None);
    }

    #[test]
    fn the_item_is_repointed_only_when_what_it_names_is_gone() {
        let here = "/Applications/Six.app/Contents/MacOS/six";
        let named = Some("/Users/a/Desktop/Six.app/Contents/MacOS/six");
        assert!(should_repoint(named, false, here, true), "the app was moved: follow it");
        assert!(!should_repoint(named, true, here, true), "the named app still exists: leave it");
        assert!(!should_repoint(named, false, "/Users/a/six/target/debug/six", false), "not from a development build");
        assert!(!should_repoint(
            named,
            false,
            "/private/var/folders/x/AppTranslocation/ABC/d/Six.app/Contents/MacOS/six",
            true
        ));
        assert!(!should_repoint(None, false, here, true), "an unreadable plist is left alone");
    }
}
