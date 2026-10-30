// intent-dock-element-pick — answers "what is under this screen point?" for the
// dock annotation overlay using only public macOS APIs.
//
//   stdin  (JSON lines): {"id":1,"cmd":"hit","x":812.5,"y":-40,"element":true,"ownPid":123,
//                         "seeThroughWindowIds":[456,789]}
//   stdout (JSON lines): {"event":"ready","trusted":true}
//                        {"id":1,"ok":true,"trusted":true,"window":{…}|null,"element":{…}|null}
//                        {"id":1,"ok":false,"error":"invalid"}
//
// Coordinates are global top-left points (the same space as Electron's screen
// DIP). The window is the front-most on-screen window at the point, skipping the
// see-through windows (the dock and the markup overlay, by CGWindowID) and any
// floating window of `ownPid` (the same surfaces when an ID is unknown). Intent's
// normal app windows are targets like any other app. It is null over the desktop,
// menus, the menu bar or any system-level surface; a click never falls through an
// opaque window to the one behind it.
//
// The element is the accessibility hit-test of that window's application, so the
// overlay never answers for itself. Only the element's actual role, name and
// frame are reported; accessibility exposes no DOM path or source file, so none
// is inferred. Without Accessibility permission `trusted` is false and `element`
// is null.
import AppKit
import ApplicationServices
import Foundation

setvbuf(stdout, nil, _IOLBF, 0)

let maxText = 512
let controlRoles: Set<String> = [
  "AXButton", "AXLink", "AXCheckBox", "AXRadioButton", "AXMenuItem", "AXMenuButton",
  "AXPopUpButton", "AXTab", "AXDisclosureTriangle", "AXCell", "AXRow",
]
let leafRoles: Set<String> = ["AXStaticText", "AXImage"]

func emit(_ object: [String: Any]) {
  guard JSONSerialization.isValidJSONObject(object),
        let data = try? JSONSerialization.data(withJSONObject: object),
        let line = String(data: data, encoding: .utf8) else { return }
  print(line)
}

func bounded(_ text: String) -> String {
  let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
  return trimmed.count > maxText ? String(trimmed.prefix(maxText)) : trimmed
}

func rectObject(_ rect: CGRect) -> [String: Double] {
  ["x": Double(rect.origin.x), "y": Double(rect.origin.y),
   "width": Double(rect.size.width), "height": Double(rect.size.height)]
}

// MARK: - Window at point

func coversDisplay(_ bounds: CGRect, at point: CGPoint) -> Bool {
  var display: CGDirectDisplayID = 0
  var count: UInt32 = 0
  guard CGGetDisplaysWithPoint(point, 1, &display, &count) == .success, count > 0 else {
    return false
  }
  return bounds.contains(CGDisplayBounds(display))
}

func windowAt(_ point: CGPoint, ownPid: pid_t, seeThrough: Set<Int>) -> [String: Any]? {
  let options: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]
  guard let list = CGWindowListCopyWindowInfo(options, kCGNullWindowID) as? [[String: Any]] else {
    return nil
  }
  // Front-to-back: the first visible, non-see-through window containing the point wins.
  for info in list {
    guard let owner = info[kCGWindowOwnerPID as String] as? Int32,
          let boundsDict = info[kCGWindowBounds as String] as? NSDictionary,
          let bounds = CGRect(dictionaryRepresentation: boundsDict),
          bounds.contains(point) else { continue }
    let alpha = (info[kCGWindowAlpha as String] as? Double) ?? 1
    if alpha <= 0.01 { continue }
    let windowId = (info[kCGWindowNumber as String] as? Int) ?? 0
    if seeThrough.contains(windowId) { continue }
    let layer = (info[kCGWindowLayer as String] as? Int) ?? 0
    // Intent's floating surfaces (dock, overlay) are transparent beyond their painted parts.
    if owner == ownPid && layer != 0 { continue }
    if layer < 0 || layer >= Int(CGWindowLevelForKey(.dockWindow)) {
      // Full-display overlays (the Screenshot toolbar, recorders) sit over everything
      // without covering it: look through them.
      if coversDisplay(bounds, at: point) { continue }
      // Menus, menu bar, Dock, status items and other system surfaces are not app windows.
      return nil
    }
    let app = (info[kCGWindowOwnerName as String] as? String) ?? ""
    return ["pid": Int(owner), "windowId": windowId, "layer": layer,
            "app": bounded(app), "bounds": rectObject(bounds)]
  }
  return nil
}

// MARK: - Accessibility element

func attribute(_ element: AXUIElement, _ name: String) -> AnyObject? {
  var value: AnyObject?
  return AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success ? value : nil
}

func string(_ element: AXUIElement, _ name: String) -> String? {
  guard let value = attribute(element, name) as? String else { return nil }
  let text = bounded(value)
  return text.isEmpty ? nil : text
}

func frame(_ element: AXUIElement) -> CGRect? {
  guard let position = attribute(element, kAXPositionAttribute),
        let size = attribute(element, kAXSizeAttribute),
        CFGetTypeID(position) == AXValueGetTypeID(),
        CFGetTypeID(size) == AXValueGetTypeID() else { return nil }
  var origin = CGPoint.zero
  var extent = CGSize.zero
  guard AXValueGetValue(position as! AXValue, .cgPoint, &origin),
        AXValueGetValue(size as! AXValue, .cgSize, &extent),
        extent.width > 0, extent.height > 0 else { return nil }
  return CGRect(origin: origin, size: extent)
}

func name(_ element: AXUIElement) -> String {
  for key in [kAXTitleAttribute, kAXDescriptionAttribute, kAXValueAttribute,
              "AXPlaceholderValue", kAXHelpAttribute] {
    if let text = string(element, key) { return text }
  }
  return ""
}

func elementAt(_ point: CGPoint, pid: pid_t) -> [String: Any]? {
  let app = AXUIElementCreateApplication(pid)
  AXUIElementSetMessagingTimeout(app, 0.25)
  var hit: AXUIElement?
  guard AXUIElementCopyElementAtPosition(app, Float(point.x), Float(point.y), &hit) == .success,
        var element = hit else { return nil }
  // A text or image leaf inside a control reports the control the user meant.
  if let role = string(element, kAXRoleAttribute), leafRoles.contains(role),
     let parent = attribute(element, kAXParentAttribute),
     CFGetTypeID(parent) == AXUIElementGetTypeID() {
    let control = parent as! AXUIElement
    if let parentRole = string(control, kAXRoleAttribute), controlRoles.contains(parentRole) {
      element = control
    }
  }
  guard let rect = frame(element) else { return nil }
  let role = string(element, kAXRoleAttribute) ?? ""
  return ["role": role, "name": name(element), "rect": rectObject(rect)]
}

// MARK: - Loop

/// The process macOS holds responsible for this helper's privacy (TCC) checks: the
/// app that must be granted Accessibility. Diagnostic only; nil when unknown.
func responsibleProcessPath() -> String? {
  typealias Responsible = @convention(c) (pid_t) -> pid_t
  guard let symbol = dlsym(UnsafeMutableRawPointer(bitPattern: -2),
                           "responsibility_get_pid_responsible_for_pid") else { return nil }
  let pid = unsafeBitCast(symbol, to: Responsible.self)(getpid())
  guard pid > 0 else { return nil }
  var buffer = [CChar](repeating: 0, count: 4096)
  guard proc_pidpath(pid, &buffer, UInt32(buffer.count)) > 0 else { return nil }
  return String(cString: buffer)
}

emit(["event": "ready", "trusted": AXIsProcessTrusted(),
      "responsible": responsibleProcessPath() ?? NSNull()])

while let line = readLine(strippingNewline: true) {
  guard let data = line.data(using: .utf8),
        let command = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
        let id = command["id"] as? Int else { continue }
  guard command["cmd"] as? String == "hit",
        let x = (command["x"] as? NSNumber)?.doubleValue,
        let y = (command["y"] as? NSNumber)?.doubleValue,
        x.isFinite, y.isFinite else {
    emit(["id": id, "ok": false, "error": "invalid"])
    continue
  }
  let ownPid = pid_t((command["ownPid"] as? NSNumber)?.int32Value ?? 0)
  let wantsElement = (command["element"] as? Bool) ?? false
  let point = CGPoint(x: x, y: y)
  let trusted = AXIsProcessTrusted()
  let seeThrough = Set(((command["seeThroughWindowIds"] as? [NSNumber]) ?? []).prefix(256).map { $0.intValue })
  let window = windowAt(point, ownPid: ownPid, seeThrough: seeThrough)
  var element: [String: Any]? = nil
  if wantsElement, trusted, let pid = window?["pid"] as? Int {
    element = elementAt(point, pid: pid_t(pid))
  }
  emit(["id": id, "ok": true, "trusted": trusted,
        "window": window ?? NSNull(), "element": element ?? NSNull()])
}
