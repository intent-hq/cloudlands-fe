import AppKit
import CoreGraphics

// Native input is separate from renderer/CDP injection: the controller reads
// Electron's actual desktop cursor to verify native click-through and focus.
// Never prompt for or alter permission settings from this fixture.
guard CGPreflightPostEventAccess() else {
    fputs("Native pointer E2E needs existing Accessibility permission; no prompt was opened.\n", stderr)
    exit(77)
}
let args = Array(CommandLine.arguments.dropFirst())
guard let command = args.first else { exit(2) }
let source = CGEventSource(stateID: .combinedSessionState)
guard args.count == 3, let x = Double(args[1]), let y = Double(args[2]), x.isFinite, y.isFinite else { exit(2) }
let point = CGPoint(x: x, y: y)
let type: CGEventType
switch command {
case "move": type = .mouseMoved
case "down": type = .leftMouseDown
case "up": type = .leftMouseUp
default: exit(2)
}
guard let event = CGEvent(mouseEventSource: source, mouseType: type, mouseCursorPosition: point, mouseButton: .left) else { exit(3) }
event.post(tap: .cghidEventTap)
