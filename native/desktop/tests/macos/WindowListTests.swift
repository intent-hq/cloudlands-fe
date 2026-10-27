import Foundation
import CoreGraphics

// Policy tests for macOS window enumeration (compiled with -parse-as-library
// against native/desktop/macos/WindowList.swift). Not evidence of live AX focus.
@main struct WindowListTests {
    static func window(_ number: UInt32, pid: Int32 = 411, layer: Int = 0, alpha: Double = 1,
                       onscreen: Bool = true, frame: CGRect = CGRect(x: 100, y: 50, width: 800, height: 500),
                       name: String? = "Start Page") -> [String: Any] {
        var entry: [String: Any] = [
            kCGWindowNumber as String: NSNumber(value: number),
            kCGWindowOwnerPID as String: NSNumber(value: pid),
            kCGWindowOwnerName as String: "Safari",
            kCGWindowLayer as String: NSNumber(value: layer),
            kCGWindowAlpha as String: NSNumber(value: alpha),
            kCGWindowIsOnscreen as String: NSNumber(value: onscreen),
            kCGWindowBounds as String: frame.dictionaryRepresentation as NSDictionary,
        ]
        if let name { entry[kCGWindowName as String] = name }
        return entry
    }

    static func main() {
        let list = [
            window(1),
            window(2, layer: 24),            // menu bar
            window(3, layer: 20),            // Dock
            window(4, alpha: 0),             // fully transparent
            window(5, onscreen: false),      // minimized / other Space
            window(6, frame: .zero),         // zero-sized
            window(7),                       // Intent overlay (excluded by number)
            window(8, pid: 522, name: ""),   // untitled, behind
            window(9, pid: 0),               // no owner
        ]
        let eligible = WindowList.eligible(list, excluding: [7])
        precondition(eligible.map(\.handle) == [1, 8], "Eligibility or z-order changed: \(eligible.map(\.handle))")
        precondition(eligible[0].title == "Start Page" && eligible[1].title == nil, "Empty titles must be omitted, never invented")
        print("PASS: macOS window eligibility excludes shell surfaces, hidden, transparent and overlay windows, keeping z-order")

        // Retina display at a negative origin: points -> image pixels, unclipped.
        let mapped = WindowList.pixels(CGRect(x: -1940, y: 25, width: 800.4, height: 500), displayOrigin: CGPoint(x: -1920, y: 0), scale: 2)
        precondition(mapped == ["x": -40, "y": 50, "width": 1601, "height": 1000], "Wrong pixel mapping: \(mapped)")
        let tiny = WindowList.pixels(CGRect(x: 0, y: 0, width: 0.2, height: 0.2), displayOrigin: .zero, scale: 1)
        precondition(tiny["width"] == 1 && tiny["height"] == 1, "Sizes must stay positive")
        print("PASS: window frames map to display-image pixels without clipping")
    }
}
