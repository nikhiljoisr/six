fn main() {
    // The notification plugin links Swift; every binary of this crate (the app, the test
    // harness) must find the Swift runtime that ships with macOS.
    #[cfg(target_os = "macos")]
    {
        println!("cargo:rustc-link-arg=-Wl,-rpath,/usr/lib/swift");
        println!("cargo:rustc-link-arg=-Wl,-rpath,/Library/Developer/CommandLineTools/usr/lib/swift/macosx");
    }
    tauri_build::build()
}
