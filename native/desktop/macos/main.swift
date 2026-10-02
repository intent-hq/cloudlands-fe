import Foundation
import AppKit
import ApplicationServices
import ScreenCaptureKit
import ImageIO
import UniformTypeIdentifiers
import IOKit
import Darwin
import CryptoKit

struct Refusal: Error {
    let code: String
    let detail: String
    var execution: String = "not_started"
}
func refused(_ detail: String) -> Refusal { Refusal(code: "desktop-unsupported-operation", detail: detail) }

// Runs on one actor. Pipe EOF releases held input and the flock; each input
// request is a single OS step, so main can cancel between any down/up pair.
@available(macOS 14.0, *)
actor Desktop {
    var lockFD: Int32 = -1
    var keys = Set<CGKeyCode>()
    var buttons = Set<String>()
    var position = CGPoint.zero
    var lastStep: UInt64 = 0
    var flags: CGEventFlags = []
    func milliseconds() -> UInt64 {
        var info = mach_timebase_info_data_t()
        mach_timebase_info(&info)
        return UInt64(Double(mach_continuous_time()) * Double(info.numer) / Double(info.denom) / 1_000_000)
    }
    func identity() throws -> [String: Any] {
        let service = IOServiceGetMatchingService(kIOMainPortDefault, IOServiceMatching("IOPlatformExpertDevice"))
        guard service != 0 else { throw refused("Machine identity unavailable") }
        defer { IOObjectRelease(service) }
        guard let uuid = IORegistryEntryCreateCFProperty(service, "IOPlatformUUID" as CFString, kCFAllocatorDefault, 0)?.takeRetainedValue() as? String else { throw refused("Machine identity unavailable") }
        let id = SHA256.hash(data: Data("\(uuid):\(getuid())".utf8)).map { String(format: "%02x", $0) }.joined()
        return ["computerId": id, "computerName": Host.current().localizedName ?? ProcessInfo.processInfo.hostName, "platform": "macos"]
    }
    func ready() throws {
        guard lockFD >= 0 else { throw Refusal(code: "desktop-not-active", detail: "The desktop lock is not held") }
        if milliseconds() - lastStep >= 15000 { release(); throw Refusal(code: "desktop-not-active", detail: "Native desktop lease expired") }
        guard let session = CGSessionCopyCurrentDictionary() as? [String: Any], session["CGSSessionScreenIsLocked"] as? Bool != true,
              session[kCGSessionOnConsoleKey as String] as? Bool == true else { release(); throw refused("The Mac session is locked or not on console") }
        guard AXIsProcessTrusted() && CGPreflightScreenCaptureAccess() else {
            release(); throw Refusal(code: "desktop-os-permission-required", detail: "Enable Screen Recording and Accessibility for Intent in macOS System Settings")
        }
        lastStep = milliseconds()
    }
    func watchdog() {
        if lockFD >= 0 && milliseconds() - lastStep >= 15000 { release() }
    }
    func displays() throws -> [CGDirectDisplayID] {
        var ids = [CGDirectDisplayID](repeating: 0, count: 64), count: UInt32 = 0
        guard CGGetActiveDisplayList(64, &ids, &count) == .success, count > 0 else { throw refused("No active displays") }
        return Array(ids.prefix(Int(count))).sorted()
    }
    func description(_ id: CGDirectDisplayID) -> [String: Any] {
        let bounds = CGDisplayBounds(id)
        let mode = CGDisplayCopyDisplayMode(id)
        let scale = mode.map { Double($0.pixelWidth) / Double($0.width) } ?? 1
        let width = Int((bounds.width * scale).rounded())
        let height = Int((bounds.height * scale).rounded())
        return ["displayId": String(id), "width": width, "height": height,
                "originX": Int((bounds.origin.x * scale).rounded()), "originY": Int((bounds.origin.y * scale).rounded()), "scaleFactor": scale]
    }
    func mapping(_ key: String) throws -> CGKeyCode {
        let named: [String: CGKeyCode] = ["Enter":36,"Tab":48,"Escape":53,"Backspace":51,"Delete":117,"Home":115,"End":119,"PageUp":116,"PageDown":121,"ArrowUp":126,"ArrowDown":125,"ArrowLeft":123,"ArrowRight":124,"Space":49,"Shift":56,"Control":59,"Alt":58,"Meta":55,
            "F1":122,"F2":120,"F3":99,"F4":118,"F5":96,"F6":97,"F7":98,"F8":100,"F9":101,"F10":109,"F11":103,"F12":111,"F13":105,"F14":107,"F15":113,"F16":106,"F17":64,"F18":79,"F19":80,"F20":90]
        if let code = named[key] { return code }
        // Printable keypress mappings must follow the current keyboard layout;
        // Unicode typing is handled separately and does not depend on that layout.
        guard let source = TISCopyCurrentKeyboardLayoutInputSource()?.takeRetainedValue(),
              let raw = TISGetInputSourceProperty(source, kTISPropertyUnicodeKeyLayoutData) else { throw refused("Keyboard layout unavailable") }
        let data = Unmanaged<CFData>.fromOpaque(raw).takeUnretainedValue()
        let layout = unsafeBitCast(CFDataGetBytePtr(data), to: UnsafePointer<UCKeyboardLayout>.self)
        for code in CGKeyCode(0)...CGKeyCode(127) {
            var dead: UInt32 = 0, length = 0
            var chars = [UniChar](repeating: 0, count: 8)
            let status = UCKeyTranslate(layout, code, UInt16(kUCKeyActionDown), 0, UInt32(LMGetKbdType()), OptionBits(kUCKeyTranslateNoDeadKeysBit), &dead, 8, &length, &chars)
            if status == noErr && String(utf16CodeUnits: chars, count: length) == key { return code }
        }
        throw refused("This key has no mapping in the active macOS keyboard layout")
    }
    func key(_ code: CGKeyCode, _ down: Bool) throws {
        guard let event = CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: down) else { throw refused("Cannot create native key event") }
        let modifier: [CGKeyCode: CGEventFlags] = [56:.maskShift,59:.maskControl,58:.maskAlternate,55:.maskCommand]
        if let flag = modifier[code] { if down { flags.insert(flag) } else { flags.remove(flag) } }
        event.flags = flags; event.post(tap: .cghidEventTap)
        if down { keys.insert(code) } else { keys.remove(code) }
    }
    func button(_ name: String, _ down: Bool, _ count: Int64 = 1) throws {
        let right = name == "right"
        let type: CGEventType = right ? (down ? .rightMouseDown : .rightMouseUp) : (down ? .leftMouseDown : .leftMouseUp)
        guard let event = CGEvent(mouseEventSource: nil, mouseType: type, mouseCursorPosition: position, mouseButton: right ? .right : .left) else { throw refused("Cannot create native mouse event") }
        event.setIntegerValueField(.mouseEventClickState, value: count); event.flags = flags; event.post(tap: .cghidEventTap)
        if down { buttons.insert(name) } else { buttons.remove(name) }
    }
    func releaseInput() {
        for code in Array(keys) { try? key(code, false) }
        for name in Array(buttons) { try? button(name, false) }
        keys.removeAll(); buttons.removeAll(); flags = []
    }
    func release() {
        releaseInput()
        if lockFD >= 0 { flock(lockFD, LOCK_UN); close(lockFD); lockFD = -1 }
    }
    func run(_ p: [String: Any]) async throws -> Any {
        guard let op = p["operation"] as? String else { throw refused("Missing operation") }
        if op == "identity" { return try identity() }
        if op == "release" { release(); return ["ok": true] }
        if op == "releaseInput" { releaseInput(); return ["ok": true] }
        if op == "acquire" {
            guard lockFD < 0 else { throw Refusal(code: "desktop-busy", detail: "Desktop already controlled") }
            // All Intent installations for this interactive uid share this lock.
            let directory = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/IntentDesktop")
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
            let fd = open(directory.appendingPathComponent("control.lock").path, O_CREAT | O_RDWR | O_NOFOLLOW, 0o600)
            guard fd >= 0 else { throw refused("Cannot open desktop lock") }
            guard flock(fd, LOCK_EX | LOCK_NB) == 0 else { close(fd); throw Refusal(code: "desktop-busy", detail: "Desktop already controlled") }
            lockFD = fd; lastStep = milliseconds(); try ready(); return ["ok": true]
        }
        try ready()
        switch op {
        case "check": return ["ok": true]
        case "layout": return try displays().map(description)
        case "capture", "validateExclusion":
            let exclusions = Set((p["excludedWindows"] as? [String] ?? []).compactMap(UInt32.init))
            guard !exclusions.isEmpty else { throw refused("Desktop indicator exclusion is unavailable") }
            let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)
            let excluded = content.windows.filter { exclusions.contains($0.windowID) }
            guard Set(excluded.map(\.windowID)) == exclusions else { throw refused("Cannot identify every desktop indicator window") }
            if op == "validateExclusion" { return ["ok": true] }
            var captures = [[String: Any]]()
            for id in try displays() {
                try ready()
                guard let display = content.displays.first(where: { $0.displayID == id }) else { throw refused("Display changed during capture") }
                var info = description(id)
                let config = SCStreamConfiguration()
                config.width = info["width"] as! Int; config.height = info["height"] as! Int
                config.showsCursor = false
                let image = try await SCScreenshotManager.captureImage(contentFilter: SCContentFilter(display: display, excludingWindows: excluded), configuration: config)
                try ready()
                let data = NSMutableData()
                guard let output = CGImageDestinationCreateWithData(data, UTType.png.identifier as CFString, 1, nil) else { throw refused("PNG encoder unavailable") }
                CGImageDestinationAddImage(output, image, nil)
                guard CGImageDestinationFinalize(output) else { throw refused("PNG encoding failed") }
                info["data"] = data.base64EncodedString(); captures.append(info)
            }
            return captures
        case "move":
            guard let d = p["display"] as? [String: Any], let text = d["displayId"] as? String, let id = UInt32(text),
                  let x = p["x"] as? Double, let y = p["y"] as? Double else { throw refused("Invalid pointer coordinates") }
            let actual = description(id)
            guard NSDictionary(dictionary: actual).isEqual(to: d), try displays().contains(id) else { throw Refusal(code: "desktop-stale-layout", detail: "Display geometry changed") }
            let bounds = CGDisplayBounds(id), scale = actual["scaleFactor"] as! Double
            guard x >= 0 && y >= 0 && x < Double(actual["width"] as! Int) && y < Double(actual["height"] as! Int) else { throw refused("Pointer outside display") }
            position = CGPoint(x: bounds.origin.x + x / scale, y: bounds.origin.y + y / scale)
            let type: CGEventType = buttons.contains("left") ? .leftMouseDragged : .mouseMoved
            guard let event = CGEvent(mouseEventSource: nil, mouseType: type, mouseCursorPosition: position, mouseButton: .left) else { throw refused("Cannot create pointer event") }
            event.flags = flags; event.post(tap: .cghidEventTap)
        case "button": try button(p["button"] as? String ?? "left", p["down"] as? Bool == true, (p["clickCount"] as? NSNumber)?.int64Value ?? 1)
        case "validateKey": _ = try mapping(p["key"] as? String ?? "")
        case "key": try key(mapping(p["key"] as? String ?? ""), p["down"] as? Bool == true)
        case "text":
            guard let text = p["text"] as? String, text.unicodeScalars.count == 1,
                  let down = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: true),
                  let up = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: false) else { throw refused("Invalid Unicode input") }
            let utf16 = Array(text.utf16)
            down.keyboardSetUnicodeString(stringLength: utf16.count, unicodeString: utf16)
            up.keyboardSetUnicodeString(stringLength: utf16.count, unicodeString: utf16)
            down.post(tap: .cghidEventTap); up.post(tap: .cghidEventTap)
        case "scroll":
            let x = p["deltaX"] as? Double ?? 0, y = p["deltaY"] as? Double ?? 0
            guard abs(x) <= Double(Int32.max), abs(y) <= Double(Int32.max), let event = CGEvent(scrollWheelEvent2Source: nil, units: .pixel, wheelCount: 2, wheel1: 0, wheel2: 0, wheel3: 0) else { throw refused("Scroll delta is unsupported") }
            event.setDoubleValueField(.scrollWheelEventPointDeltaAxis1, value: -y)
            event.setDoubleValueField(.scrollWheelEventPointDeltaAxis2, value: -x)
            event.post(tap: .cghidEventTap)
        default: throw refused("Unknown helper operation")
        }
        return ["ok": true]
    }
}

import Carbon
signal(SIGPIPE, SIG_IGN)
if #available(macOS 14.0, *) {
    let desktop = Desktop()
    Task.detached {
        while true { try? await Task.sleep(nanoseconds: 500_000_000); await desktop.watchdog() }
    }
    Task.detached {
        while let line = readLine() {
            var id: Any = 0
            let reply: [String: Any]
            do {
                guard let p = try JSONSerialization.jsonObject(with: Data(line.utf8)) as? [String: Any] else { throw refused("Invalid helper request") }
                id = p["id"] ?? 0
                reply = ["id": id, "result": try await desktop.run(p)]
            } catch {
                await desktop.releaseInput()
                let failure = error as? Refusal ?? Refusal(code: "desktop-execution-failed", detail: "The native macOS operation failed", execution: "unknown")
                reply = ["id": id, "error": ["code": failure.code, "detail": failure.detail, "execution": failure.execution]]
            }
            if let data = try? JSONSerialization.data(withJSONObject: reply) {
                let line = data + Data([10])
                let sent = line.withUnsafeBytes { Darwin.write(STDOUT_FILENO, $0.baseAddress!, line.count) }
                if sent < 0 { await desktop.release(); exit(0) }
            }
        }
        await desktop.release(); exit(0)
    }
    RunLoop.main.run()
} else {
    while let line = readLine() {
        let p = (try? JSONSerialization.jsonObject(with: Data(line.utf8))) as? [String: Any]
        let reply: [String: Any] = ["id": p?["id"] ?? 0, "error": ["code":"desktop-unsupported", "detail":"Desktop control requires macOS 14 or newer", "execution":"not_started"]]
        if let data = try? JSONSerialization.data(withJSONObject: reply) { FileHandle.standardOutput.write(data); FileHandle.standardOutput.write(Data([10])) }
    }
}
