import Foundation
import ApplicationServices
import Darwin

// Compile on CI; run on an isolated, unlocked Mac with the helper's Accessibility
// and Screen Recording grants and this observer's Input Monitoring permission.
// Usage: desktop-pointer-tests /absolute/path/to/intent-desktop-helper
final class PointerEvidence {
    var moved = 0
    var buttons = 0
}

@main struct PointerMoveTest {
    static func require(_ condition: Bool, _ message: String) throws {
        if !condition { throw NSError(domain: "DesktopPointerTest", code: 1,
                                      userInfo: [NSLocalizedDescriptionKey: message]) }
    }

    static func main() throws {
        try require(CommandLine.arguments.count == 2, "Supply the native helper path")
        let evidence = PointerEvidence()
        let events: [CGEventType] = [.mouseMoved, .leftMouseDown, .leftMouseUp,
                                     .rightMouseDown, .rightMouseUp, .otherMouseDown,
                                     .otherMouseUp, .leftMouseDragged, .rightMouseDragged]
        let mask = events.reduce(CGEventMask(0)) { $0 | (CGEventMask(1) << $1.rawValue) }
        guard let tap = CGEvent.tapCreate(tap: .cgSessionEventTap, place: .tailAppendEventTap,
            options: .listenOnly, eventsOfInterest: mask, callback: { _, type, event, context in
                let state = Unmanaged<PointerEvidence>.fromOpaque(context!).takeUnretainedValue()
                if type == .mouseMoved { state.moved += 1 }
                else if type != .tapDisabledByTimeout && type != .tapDisabledByUserInput { state.buttons += 1 }
                return Unmanaged.passUnretained(event)
            }, userInfo: Unmanaged.passUnretained(evidence).toOpaque()) else {
            throw NSError(domain: "DesktopPointerTest", code: 2,
                          userInfo: [NSLocalizedDescriptionKey: "Input Monitoring permission is required for native event evidence"])
        }
        let source = CFMachPortCreateRunLoopSource(nil, tap, 0)
        CFRunLoopAddSource(CFRunLoopGetCurrent(), source, .commonModes)
        defer { CFMachPortInvalidate(tap) }
        let process = Process(), input = Pipe(), output = Pipe()
        process.executableURL = URL(fileURLWithPath: CommandLine.arguments[1])
        process.standardInput = input; process.standardOutput = output
        try process.run()
        defer { try? input.fileHandleForWriting.close(); if process.isRunning { process.terminate() } }
        var sequence = 0
        func call(_ operation: String, _ fields: [String: Any] = [:], error expected: String? = nil) throws -> Any {
            sequence += 1
            var request = fields; request["id"] = sequence; request["operation"] = operation
            var data = try JSONSerialization.data(withJSONObject: request); data.append(10)
            try input.fileHandleForWriting.write(contentsOf: data)
            var response = Data()
            let deadline = Date().addingTimeInterval(10)
            while response.last != 10 {
                var fd = pollfd(fd: output.fileHandleForReading.fileDescriptor, events: Int16(POLLIN), revents: 0)
                let remaining = Int32(max(0, deadline.timeIntervalSinceNow * 1000))
                try require(remaining > 0 && poll(&fd, 1, remaining) > 0, "Helper response timed out")
                guard let byte = try output.fileHandleForReading.read(upToCount: 1), !byte.isEmpty else {
                    throw NSError(domain: "DesktopPointerTest", code: 3, userInfo: [NSLocalizedDescriptionKey: "Helper exited"])
                }
                response.append(byte)
            }
            let reply = try JSONSerialization.jsonObject(with: response) as! [String: Any]
            try require(reply["id"] as? Int == sequence, "Mismatched helper response")
            if let expected {
                try require((reply["error"] as? [String: Any])?["code"] as? String == expected, "Wrong native refusal: \(reply)")
            } else { try require(reply["error"] == nil, "Native request failed: \(reply)") }
            return reply["result"] ?? NSNull()
        }
        _ = try call("acquire")
        defer { _ = try? call("release") }
        let layout = try call("layout") as! [[String: Any]]
        let display = layout.first!
        let id = UInt32(display["displayId"] as! String)!
        let bounds = CGDisplayBounds(id), scale = display["scaleFactor"] as! Double
        let x = Double(display["width"] as! Int) / 2, y = Double(display["height"] as! Int) / 2
        let target = CGPoint(x: bounds.minX + x / scale, y: bounds.minY + y / scale)
        let params: [String: Any] = ["display": display, "layout": layout, "x": x, "y": y]
        _ = try call("move", params)
        CFRunLoopRunInMode(.defaultMode, 0.25, false)
        let position = CGEvent(source: nil)!.location
        try require(abs(position.x - target.x) <= 1 && abs(position.y - target.y) <= 1,
                    "Screenshot pixels did not map to the native cursor")
        try require(evidence.moved > 0 && evidence.buttons == 0, "Move lacked motion or synthesized a button/drag event")
        try require(!CGEventSource.buttonState(.combinedSessionState, button: .left) &&
                    !CGEventSource.buttonState(.combinedSessionState, button: .right), "Move held a button")
        _ = try call("move", ["display": display, "layout": [], "x": 0, "y": 0], error: "desktop-stale-layout")
        try require(CGEvent(source: nil)!.location == position, "Rejected move changed cursor position")
        print("PASS: native macOS cursor-only movement, pixel mapping and stale-layout refusal")
    }
}
