// render URL OUT.png WIDTH HEIGHT [WAIT_MS] [--dark]
// Loads a page in an offscreen WKWebView and writes a 2x PNG. No window is shown, so it
// works with the screen locked. --dark renders with the system's dark appearance.
import AppKit
import WebKit

let args = CommandLine.arguments.filter { $0 != "--dark" }
let dark = CommandLine.arguments.contains("--dark")
guard args.count >= 5, let url = URL(string: args[1]), let width = Double(args[3]), let height = Double(args[4]) else {
    FileHandle.standardError.write("usage: render URL OUT.png WIDTH HEIGHT [WAIT_MS] [--dark]\n".data(using: .utf8)!)
    exit(2)
}
let waitMs = args.count > 5 ? (Double(args[5]) ?? 2500) : 2500

let app = NSApplication.shared
app.setActivationPolicy(.prohibited)
let web = WKWebView(frame: NSRect(x: 0, y: 0, width: width, height: height), configuration: WKWebViewConfiguration())
web.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
web.load(URLRequest(url: url))

DispatchQueue.main.asyncAfter(deadline: .now() + waitMs / 1000) {
    let config = WKSnapshotConfiguration()
    config.snapshotWidth = NSNumber(value: width * 2)
    web.takeSnapshot(with: config) { image, error in
        guard let image, let tiff = image.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff),
              let png = rep.representation(using: .png, properties: [:]) else {
            FileHandle.standardError.write("snapshot failed: \(String(describing: error))\n".data(using: .utf8)!)
            exit(1)
        }
        do {
            try png.write(to: URL(fileURLWithPath: args[2]))
            exit(0)
        } catch {
            FileHandle.standardError.write("could not write \(args[2]): \(error)\n".data(using: .utf8)!)
            exit(1)
        }
    }
}
app.run()
