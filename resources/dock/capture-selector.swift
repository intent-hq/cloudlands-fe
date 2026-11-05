// Explicit selection owns the geometry it returns. Never infer a screen origin from PNG size.
import AppKit
import CoreGraphics
import Foundation
import ImageIO
import ScreenCaptureKit

func emit(_ value: [String: Any]) -> Never {
  if let data = try? JSONSerialization.data(withJSONObject: value) {
    FileHandle.standardOutput.write(data); FileHandle.standardOutput.write(Data([10]))
  }
  exit(0)
}
let args = Array(CommandLine.arguments.dropFirst())
let mode = args.first ?? ""
let excluded = Set(args.dropFirst().compactMap { UInt32($0) })
guard mode == "window" || mode == "region" else { emit(["ok": false, "error": "failed"]) }
guard CGPreflightScreenCaptureAccess() else { emit(["ok": false, "error": "permission"]) }
func quartz(_ point: CGPoint) -> CGPoint {
  CGPoint(x: point.x, y: CGDisplayBounds(CGMainDisplayID()).height - point.y)
}
final class SelectionPanel: NSPanel {
  override var canBecomeKey: Bool { true }
}
@available(macOS 14.2, *)
final class Selector {
  let content: SCShareableContent
  var panels: [SelectionPanel] = []
  var start: CGPoint?
  var selectedDisplay: SCDisplay?
  var highlighted: CGRect?
  var finished = false
  init(_ content: SCShareableContent) { self.content = content }
  func target(at point: CGPoint) -> SCWindow? {
    // ScreenCaptureKit's on-screen window order follows front-to-back CGWindow order.
    let order = (CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? [])
      .compactMap { ($0[kCGWindowNumber as String] as? NSNumber)?.uint32Value }
    let windows = Dictionary(uniqueKeysWithValues: content.windows.filter {
      $0.isOnScreen && $0.owningApplication?.processID != getpid() && !excluded.contains($0.windowID)
    }.map { ($0.windowID, $0) })
    return order.compactMap { windows[$0] }.first { $0.frame.contains(point) && $0.frame.width > 1 && $0.frame.height > 1 }
  }
  func show() {
    for screen in NSScreen.screens {
      let panel = SelectionPanel(contentRect: screen.frame, styleMask: [.borderless], backing: .buffered, defer: false)
      panel.level = .screenSaver; panel.isOpaque = false; panel.backgroundColor = .clear
      panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
      let view = SelectionView(frame: CGRect(origin: .zero, size: screen.frame.size))
      view.selector = self; panel.contentView = view; panel.acceptsMouseMovedEvents = true
      panels.append(panel); panel.makeKeyAndOrderFront(nil)
    }
    NSApp.activate(ignoringOtherApps: true)
  }
  func update(_ point: CGPoint) {
    if mode == "window" { highlighted = target(at: point)?.frame }
    else if let start, let display = selectedDisplay {
      highlighted = CGRect(x: min(start.x, point.x), y: min(start.y, point.y),
        width: abs(point.x - start.x), height: abs(point.y - start.y)).intersection(display.frame)
    }
    for panel in panels { panel.contentView?.needsDisplay = true }
  }
  func down(_ point: CGPoint) {
    start = point; selectedDisplay = content.displays.first { $0.frame.contains(point) }; update(point)
  }
  func up(_ point: CGPoint) {
    guard !finished else { return }; update(point)
    let window = mode == "window" ? target(at: point) : nil
    let rect = window?.frame ?? (highlighted ?? .zero).integral
    let display = mode == "window" ? content.displays.first { $0.frame.contains(point) } : selectedDisplay
    guard let display, rect.width > 1, rect.height > 1 else { return }
    finished = true
    for panel in panels { panel.orderOut(nil) }
    Task { await capture(rect, display: display, window: window) }
  }
  func capture(_ rect: CGRect, display: SCDisplay, window: SCWindow?) async {
    do {
      try await Task.sleep(nanoseconds: 150_000_000)
      // Re-resolve the exact display/window after selection. A moved/resized target
      // is refused rather than publishing pixels with a stale coordinate frame.
      let fresh = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
      guard let currentDisplay = fresh.displays.first(where: { $0.displayID == display.displayID }), currentDisplay.frame == display.frame else {
        emit(["ok": false, "error": "failed"])
      }
      let filter: SCContentFilter
      if let window {
        guard let current = fresh.windows.first(where: { $0.windowID == window.windowID }), current.frame == rect else {
          emit(["ok": false, "error": "failed"])
        }
        filter = SCContentFilter(desktopIndependentWindow: current)
      } else {
        let windows = fresh.windows.filter { excluded.contains($0.windowID) || $0.owningApplication?.processID == getpid() }
        filter = SCContentFilter(display: currentDisplay, excludingWindows: windows)
      }
      let config = SCStreamConfiguration()
      let nativeScale = Double(CGDisplayCopyDisplayMode(display.displayID)?.pixelWidth ?? Int(display.width)) / Double(display.frame.width)
      let scale = min(nativeScale, 4096 / max(rect.width, rect.height))
      config.width = max(1, Int((rect.width * scale).rounded()))
      config.height = max(1, Int((rect.height * scale).rounded()))
      config.showsCursor = false; config.capturesAudio = false
      config.ignoreShadowsSingleWindow = true
      if window == nil { config.sourceRect = rect.offsetBy(dx: -display.frame.minX, dy: -display.frame.minY) }
      let image = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: config)
      let verified = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
      guard verified.displays.first(where: { $0.displayID == display.displayID })?.frame == display.frame,
        window == nil || verified.windows.first(where: { $0.windowID == window!.windowID })?.frame == rect else {
        emit(["ok": false, "error": "failed"])
      }
      let data = NSMutableData()
      guard let destination = CGImageDestinationCreateWithData(data, "public.png" as CFString, 1, nil) else { emit(["ok": false, "error": "failed"]) }
      CGImageDestinationAddImage(destination, image, nil)
      guard CGImageDestinationFinalize(destination) else { emit(["ok": false, "error": "failed"]) }
      emit(["ok": true, "base64": (data as Data).base64EncodedString(), "width": image.width, "height": image.height,
        "displayScale": Double(image.width) / rect.width,
        "capture": ["mode": mode, "frame": ["displayId": display.displayID,
          "coordinateSpace": "screen-points-top-left", "rect": ["x": rect.minX, "y": rect.minY, "w": rect.width, "h": rect.height]]]])
    } catch { emit(["ok": false, "error": "failed"]) }
  }
}
@available(macOS 14.2, *)
final class SelectionView: NSView {
  weak var selector: Selector?
  override var acceptsFirstResponder: Bool { true }
  override func viewDidMoveToWindow() { window?.makeFirstResponder(self) }
  override func resetCursorRects() { addCursorRect(bounds, cursor: .crosshair) }
  override func mouseDown(with event: NSEvent) { selector?.down(quartz(NSEvent.mouseLocation)) }
  override func mouseDragged(with event: NSEvent) { selector?.update(quartz(NSEvent.mouseLocation)) }
  override func mouseMoved(with event: NSEvent) { selector?.update(quartz(NSEvent.mouseLocation)) }
  override func mouseUp(with event: NSEvent) { selector?.up(quartz(NSEvent.mouseLocation)) }
  override func keyDown(with event: NSEvent) { if event.keyCode == 53 { emit(["ok": false, "error": "cancelled"]) } }
  override func draw(_ dirtyRect: NSRect) {
    NSColor.black.withAlphaComponent(0.16).setFill(); bounds.fill()
    guard let rect = selector?.highlighted, let window else { return }
    let appRect = CGRect(x: rect.minX, y: CGDisplayBounds(CGMainDisplayID()).height - rect.maxY, width: rect.width, height: rect.height)
    let local = window.convertFromScreen(appRect)
    NSColor.controlAccentColor.setStroke(); let path = NSBezierPath(rect: local); path.lineWidth = 2; path.stroke()
  }
}
var owner: AnyObject?
if #available(macOS 14.2, *) {
  let app = NSApplication.shared; app.setActivationPolicy(.accessory)
  Task { @MainActor in
    do {
      let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
      let selector = Selector(content); owner = selector; selector.show()
    } catch { emit(["ok": false, "error": "failed"]) }
  }
  app.run()
} else { emit(["ok": false, "error": "unavailable"]) }
