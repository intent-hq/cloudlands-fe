import AppKit

struct Rect: Encodable {
    let x: Double
    let y: Double
    let width: Double
    let height: Double
}
struct DisplayGeometry: Encodable {
    let id: UInt32
    let cutout: Rect?
}

// Return local top-left DIP, avoiding assumptions about the arrangement of NSScreens.
// Electron associates each record by CGDirectDisplayID and adds its own bounds origin.
let displays = NSScreen.screens.compactMap { screen -> DisplayGeometry? in
    guard let number = screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber else { return nil }
    var cutout: Rect? = nil
    if #available(macOS 12.0, *),
       screen.safeAreaInsets.top > 0,
       let left = screen.auxiliaryTopLeftArea,
       let right = screen.auxiliaryTopRightArea,
       right.minX > left.maxX {
        cutout = Rect(x: Double(left.maxX - screen.frame.minX), y: 0,
                      width: Double(right.minX - left.maxX), height: Double(screen.safeAreaInsets.top))
    }
    return DisplayGeometry(id: number.uint32Value, cutout: cutout)
}
let data = try JSONEncoder().encode(displays)
FileHandle.standardOutput.write(data)
