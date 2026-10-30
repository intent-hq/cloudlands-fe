import Foundation
import CoreGraphics

/// One on-screen window from CGWindowListCopyWindowInfo, in global CG points.
struct WindowEntry: Equatable {
    let handle: UInt32
    let pid: Int32
    let ownerName: String?
    let title: String?
    let bounds: CGRect
}

/// Pure window-list policy, kept free of AX/AppKit so it can be tested on CI.
enum WindowList {
    /// Keeps eligible windows from a front-to-back CG window list: ordinary
    /// application windows (layer 0, so no menu bar, Dock or shell surfaces),
    /// on screen (so not minimized, hidden or on another Space), not fully
    /// transparent, non-empty, and not one of Intent's overlay windows.
    static func eligible(_ info: [[String: Any]], excluding: Set<UInt32>) -> [WindowEntry] {
        info.compactMap { entry in
            guard let number = (entry[kCGWindowNumber as String] as? NSNumber)?.uint32Value,
                  !excluding.contains(number),
                  let pid = (entry[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value, pid > 0,
                  (entry[kCGWindowLayer as String] as? NSNumber)?.intValue == 0,
                  ((entry[kCGWindowAlpha as String] as? NSNumber)?.doubleValue ?? 1) > 0,
                  (entry[kCGWindowIsOnscreen as String] as? NSNumber)?.boolValue ?? true,
                  let raw = entry[kCGWindowBounds as String] as? NSDictionary,
                  let bounds = CGRect(dictionaryRepresentation: raw as CFDictionary),
                  bounds.width > 0, bounds.height > 0 else { return nil }
            let title = (entry[kCGWindowName as String] as? String).flatMap { $0.isEmpty ? nil : $0 }
            return WindowEntry(handle: number, pid: pid, ownerName: entry[kCGWindowOwnerName as String] as? String,
                               title: title, bounds: bounds)
        }
    }

    /// Maps a global CG-point frame to the display's image pixels. Not clipped:
    /// x/y may be negative or extend past the image; size is at least 1 pixel.
    static func pixels(_ bounds: CGRect, displayOrigin: CGPoint, scale: Double) -> [String: Int] {
        let x = Int(((bounds.minX - displayOrigin.x) * scale).rounded())
        let y = Int(((bounds.minY - displayOrigin.y) * scale).rounded())
        let width = max(1, Int((bounds.width * scale).rounded()))
        let height = max(1, Int((bounds.height * scale).rounded()))
        return ["x": x, "y": y, "width": width, "height": height]
    }
}
