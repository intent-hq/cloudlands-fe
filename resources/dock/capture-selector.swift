// Explicit selection owns the geometry it returns. Never infer a screen origin from PNG size.
import AppKit
import CoreGraphics
import Foundation
import ImageIO
import ScreenCaptureKit

// Private CGS call (as used by app switchers): while the window picker is up, the system
// Cmd-Tab switcher is off so Cmd-Tab reaches the picker. Every exit path turns it back on.
@_silgen_name("CGSSetSymbolicHotKeyEnabled")
func CGSSetSymbolicHotKeyEnabled(_ hotKey: Int32, _ enabled: Bool) -> CGError
let commandTabHotKeys: [Int32] = [1, 2]
var commandTabSuppressed = false
var commandTabTap: CFMachPort?
var commandTabStep: ((Int) -> Void)?
func setSystemCommandTab(enabled: Bool) {
  guard commandTabSuppressed == enabled else { return }
  for key in commandTabHotKeys { _ = CGSSetSymbolicHotKeyEnabled(key, enabled) }
  commandTabSuppressed = !enabled
  if enabled, let tap = commandTabTap { CGEvent.tapEnable(tap: tap, enable: false) }
}
/// With the switcher off, macOS does not reliably deliver Cmd-Tab to the picker, so a
/// session tap takes it first. The tap needs Accessibility (Intent's grant); without it the
/// system switcher stays on and Tab and the arrow keys still cycle.
func tapCommandTab(_ step: @escaping (Int) -> Void) -> Bool {
  commandTabStep = step
  let mask = CGEventMask(1 << CGEventType.keyDown.rawValue) | CGEventMask(1 << CGEventType.keyUp.rawValue)
  commandTabTap = CGEvent.tapCreate(tap: .cgSessionEventTap, place: .headInsertEventTap, options: .defaultTap,
    eventsOfInterest: mask, callback: { _, type, event, _ in
      if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
        if commandTabSuppressed, let tap = commandTabTap { CGEvent.tapEnable(tap: tap, enable: true) }
        return Unmanaged.passUnretained(event)
      }
      guard commandTabSuppressed, event.getIntegerValueField(.keyboardEventKeycode) == 48,
        event.flags.contains(.maskCommand) else { return Unmanaged.passUnretained(event) }
      if type == .keyDown { commandTabStep?(event.flags.contains(.maskShift) ? -1 : 1) }
      return nil
    }, userInfo: nil)
  guard let tap = commandTabTap else { return false }
  CFRunLoopAddSource(CFRunLoopGetMain(), CFMachPortCreateRunLoopSource(nil, tap, 0), .commonModes)
  CGEvent.tapEnable(tap: tap, enable: true)
  return true
}
var signalSources: [DispatchSourceSignal] = []
/// SIGTERM (timeout, abort) and a vanished parent must not leave Cmd-Tab disabled.
func restoreCommandTabOnExit() {
  for code in [SIGTERM, SIGINT, SIGHUP] {
    signal(code, SIG_IGN)
    let source = DispatchSource.makeSignalSource(signal: code, queue: .main)
    source.setEventHandler { emit(["ok": false, "error": "cancelled"]) }
    source.resume(); signalSources.append(source)
  }
  Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { _ in
    if getppid() == 1 { emit(["ok": false, "error": "cancelled"]) }
  }
}

func emit(_ value: [String: Any]) -> Never {
  setSystemCommandTab(enabled: true)
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
  /// Eligible windows, front to back. ScreenCaptureKit's order follows CGWindow order.
  let ordered: [SCWindow]
  /// Normal app windows that keyboard cycling steps through, including covered ones.
  let cycle: [SCWindow]
  var panels: [SelectionPanel] = []
  var start: CGPoint?
  var selectedDisplay: SCDisplay?
  var highlighted: CGRect?
  var selection: SCWindow?
  /// A window raised by the keyboard; it stays selected until the pointer moves on.
  var raised: SCWindow?
  var raisedAt: CGPoint?
  var previews: [CGWindowID: CGImage] = [:]
  var finished = false
  init(_ content: SCShareableContent) {
    self.content = content
    let order = (CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? [])
      .compactMap { ($0[kCGWindowNumber as String] as? NSNumber)?.uint32Value }
    let windows = Dictionary(uniqueKeysWithValues: content.windows.filter {
      $0.isOnScreen && $0.owningApplication?.processID != getpid() && !excluded.contains($0.windowID)
        && $0.frame.width > 1 && $0.frame.height > 1
    }.map { ($0.windowID, $0) })
    ordered = order.compactMap { windows[$0] }
    cycle = ordered.filter { $0.windowLayer == 0 && $0.frame.width >= 40 && $0.frame.height >= 40 }
  }
  func target(at point: CGPoint) -> SCWindow? {
    if let raised, raised.frame.contains(point) { return raised }
    return ordered.first { $0.frame.contains(point) }
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
    if mode == "window" {
      restoreCommandTabOnExit()
      if tapCommandTab({ [weak self] delta in self?.step(delta) }) { setSystemCommandTab(enabled: false) }
      update(quartz(NSEvent.mouseLocation))
    }
  }
  func redraw() { for panel in panels { panel.contentView?.needsDisplay = true } }
  func update(_ point: CGPoint) {
    if mode == "window" {
      // Small pointer drift after a key press must not drop the window the keyboard raised.
      if raised != nil, let raisedAt, hypot(point.x - raisedAt.x, point.y - raisedAt.y) < 24 { return }
      if let raised, !raised.frame.contains(point) { self.raised = nil; raisedAt = nil }
      selection = target(at: point); highlighted = selection?.frame
    } else if let start, let display = selectedDisplay {
      highlighted = CGRect(x: min(start.x, point.x), y: min(start.y, point.y),
        width: abs(point.x - start.x), height: abs(point.y - start.y)).intersection(display.frame)
    }
    redraw()
  }
  func step(_ delta: Int) {
    guard mode == "window", !finished, !cycle.isEmpty else { return }
    let index = selection.flatMap { current in cycle.firstIndex { $0.windowID == current.windowID } }
    let next = index.map { ($0 + delta + cycle.count) % cycle.count } ?? (delta > 0 ? 0 : cycle.count - 1)
    let window = cycle[next]
    raised = window; raisedAt = quartz(NSEvent.mouseLocation)
    selection = window; highlighted = window.frame
    loadPreview(window)
    redraw()
  }
  func loadPreview(_ window: SCWindow) {
    guard previews[window.windowID] == nil else { return }
    let filter = SCContentFilter(desktopIndependentWindow: window)
    let config = SCStreamConfiguration()
    let scale = Double(filter.pointPixelScale)
    config.width = max(1, Int((window.frame.width * scale).rounded()))
    config.height = max(1, Int((window.frame.height * scale).rounded()))
    config.showsCursor = false; config.capturesAudio = false
    config.ignoreShadowsSingleWindow = true
    let id = window.windowID
    Task { @MainActor [weak self] in
      guard let image = try? await SCScreenshotManager.captureImage(contentFilter: filter, configuration: config) else { return }
      self?.previews[id] = image; self?.redraw()
    }
  }
  func display(for window: SCWindow) -> SCDisplay? {
    let area = { (display: SCDisplay) -> CGFloat in
      let overlap = display.frame.intersection(window.frame)
      return overlap.isNull ? 0 : overlap.width * overlap.height
    }
    return content.displays.filter { area($0) > 0 }.max { area($0) < area($1) }
  }
  func confirm() {
    guard mode == "window", !finished, let window = selection, let display = display(for: window) else { return }
    finished = true
    for panel in panels { panel.orderOut(nil) }
    setSystemCommandTab(enabled: true)
    Task { await capture(window.frame, display: display, window: window) }
  }
  func down(_ point: CGPoint) {
    start = point; selectedDisplay = content.displays.first { $0.frame.contains(point) }; update(point)
  }
  func up(_ point: CGPoint) {
    guard !finished else { return }; update(point)
    if mode == "window" { return confirm() }
    let rect = (highlighted ?? .zero).integral
    guard let display = selectedDisplay, rect.width > 1, rect.height > 1 else { return }
    finished = true
    for panel in panels { panel.orderOut(nil) }
    Task { await capture(rect, display: display, window: nil) }
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
  override func keyDown(with event: NSEvent) {
    let back = event.modifierFlags.contains(.shift)
    switch event.keyCode {
    case 53: emit(["ok": false, "error": "cancelled"])
    case 48: selector?.step(back ? -1 : 1)
    case 124, 125: selector?.step(1)
    case 123, 126: selector?.step(-1)
    case 36, 76, 49: selector?.confirm()
    default: super.keyDown(with: event)
    }
  }
  func local(_ rect: CGRect) -> CGRect? {
    guard let window else { return nil }
    let appRect = CGRect(x: rect.minX, y: CGDisplayBounds(CGMainDisplayID()).height - rect.maxY, width: rect.width, height: rect.height)
    return window.convertFromScreen(appRect)
  }
  override func draw(_ dirtyRect: NSRect) {
    NSColor.black.withAlphaComponent(0.16).setFill(); bounds.fill()
    guard let selector else { return }
    if let raised = selector.raised, let image = selector.previews[raised.windowID], let rect = local(raised.frame),
      let context = NSGraphicsContext.current?.cgContext {
      context.saveGState()
      context.setShadow(offset: CGSize(width: 0, height: -12), blur: 40, color: NSColor.black.withAlphaComponent(0.45).cgColor)
      context.draw(image, in: rect)
      context.restoreGState()
    }
    if let rect = selector.highlighted, let local = local(rect) {
      NSColor.controlAccentColor.setStroke(); let path = NSBezierPath(rect: local); path.lineWidth = 2; path.stroke()
    }
    if mode == "window" { drawHint(selector) }
  }
  /// Names the selected window and shows the cycling keys, on the screen that holds it.
  func drawHint(_ selector: Selector) {
    guard let window else { return }
    let anchor: CGPoint
    if let frame = selector.selection?.frame {
      anchor = CGPoint(x: frame.midX, y: CGDisplayBounds(CGMainDisplayID()).height - frame.midY)
    } else { anchor = NSEvent.mouseLocation }
    let screen = window.screen ?? NSScreen.main
    guard let screen, screen.frame.contains(anchor) || (selector.selection == nil && NSScreen.screens.count == 1) else { return }
    let selected = selector.selection
    let app = selected?.owningApplication?.applicationName ?? ""
    let title = (selected?.title ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    var name = [app, title].filter { !$0.isEmpty }.joined(separator: " \u{2014} ")
    if name.count > 72 { name = String(name.prefix(71)) + "\u{2026}" }
    let text: [NSAttributedString.Key: Any] = [.font: NSFont.systemFont(ofSize: 13, weight: .medium), .foregroundColor: NSColor.white]
    let key: [NSAttributedString.Key: Any] = [.font: NSFont.systemFont(ofSize: 11, weight: .semibold), .foregroundColor: NSColor.white.withAlphaComponent(0.8)]
    let label = NSAttributedString(string: name, attributes: text)
    let keys = ["\u{21E5}", "\u{21A9}", "esc"].map { NSAttributedString(string: $0, attributes: key) }
    let height: CGFloat = 36, padding: CGFloat = 14, gap: CGFloat = 6, capHeight: CGFloat = 20
    let capWidths = keys.map { max(capHeight, ceil($0.size().width) + 10) }
    let keysWidth = capWidths.reduce(0, +) + gap * CGFloat(keys.count - 1)
    let labelWidth = name.isEmpty ? 0 : ceil(label.size().width) + 12
    let width = padding * 2 + labelWidth + keysWidth
    let visible = window.convertFromScreen(screen.visibleFrame)
    let pill = CGRect(x: (visible.midX - width / 2).rounded(), y: visible.minY + 28, width: width, height: height)
    NSColor(white: 0.1, alpha: 0.86).setFill(); NSBezierPath(roundedRect: pill, xRadius: height / 2, yRadius: height / 2).fill()
    var x = pill.minX + padding
    if !name.isEmpty {
      label.draw(at: CGPoint(x: x, y: pill.midY - label.size().height / 2)); x += labelWidth
    }
    for (index, cap) in keys.enumerated() {
      let box = CGRect(x: x, y: pill.midY - capHeight / 2, width: capWidths[index], height: capHeight)
      NSColor(white: 1, alpha: 0.14).setFill(); NSBezierPath(roundedRect: box, xRadius: 5, yRadius: 5).fill()
      cap.draw(at: CGPoint(x: box.midX - cap.size().width / 2, y: box.midY - cap.size().height / 2))
      x += capWidths[index] + gap
    }
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
