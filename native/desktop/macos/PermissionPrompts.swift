import Foundation

// Pure prompt policy: checks never imply grants; only a new local Allow gesture
// calls this policy. One gesture asks for every missing permission (Accessibility,
// then Screen Recording) so the user relaunches at most once; each permission is
// requested once per helper and denial never loops. macOS owns its dialogs and
// any required relaunch. The SCK readiness probe follows once both are granted.
struct PermissionPrompts {
    enum Prompt { case accessibility, screenRecording }
    private var accessibilityRequested = false
    private var screenRecordingRequested = false
    mutating func due(accessibility: Bool, screenRecording: Bool) -> [Prompt] {
        var prompts: [Prompt] = []
        if !accessibility && !accessibilityRequested {
            accessibilityRequested = true
            prompts.append(.accessibility)
        }
        if !screenRecording && !screenRecordingRequested {
            screenRecordingRequested = true
            prompts.append(.screenRecording)
        }
        return prompts
    }
}

// Observation has no desktop authority. A polling gap cancels the one probe;
// late completion cannot revive it or a successor request. OS-owned dialogs
// cannot be dismissed here, and missing access cannot distinguish waiting/denial.
struct PermissionReadiness {
    private(set) var requestId: String?
    private(set) var generation: UInt64 = 0
    private(set) var state = "unavailable"
    private var lastPoll: UInt64 = 0
    private var inFlight: UInt64?
    private var completed: [String: (state: String, at: UInt64)] = [:]
    func status(for id: String) -> String {
        completed[id]?.state ?? (requestId == id ? state : "pending")
    }
    mutating func observe(requestId: String, granted: Bool, now: UInt64) -> UInt64? {
        // A daemon request expires within five minutes. This is only OS setup
        // bookkeeping; the authenticated caller still checks the actual expiry.
        completed = completed.filter { now - $0.value.at < 300000 }
        if !granted {
            completed = completed.filter { $0.value.state != "ready" }
            if state == "pending" { abandon() }
            return nil
        }
        if completed[requestId] != nil { return nil }
        // Do not cancel another user-approved request or launch overlapping OS
        // calls. Cancellation is cooperative: retain a canceled probe until its
        // OS callback returns, even though its result can no longer be used.
        if inFlight != nil {
            if self.requestId == requestId && state == "pending" { lastPoll = now }
            return nil
        }
        self.requestId = requestId; lastPoll = now
        generation += 1; state = "pending"; inFlight = generation
        return generation
    }
    mutating func complete(_ token: UInt64, ready: Bool) {
        guard inFlight == token else { return }
        inFlight = nil
        guard token == generation, state == "pending", let id = requestId else { return }
        state = ready ? "ready" : "unavailable"
        completed[id] = (state, lastPoll)
    }
    private mutating func abandon() {
        if let id = requestId { completed[id] = ("unavailable", lastPoll) }
        generation += 1; state = "unavailable"
    }
    mutating func expire(now: UInt64) -> Bool {
        guard state == "pending", now - lastPoll >= 3000 else { return false }
        abandon()
        return true
    }
}


// Pure ownership policy shared by the native adapter and synthetic policy tests.
// Chromium can take seconds to expose its tree. Keep our readiness transition
// across short foreground samples, without blocking a sample or acquiring input.
final class FigmaAccessibilityReadiness<Owner: Equatable> {
    private struct Lease { let owner: Owner; let changed: Bool; var lastSample: UInt64 }
    private var lease: Lease?
    private let lock = NSLock()
    private let current: () -> Owner?
    private let alive: (Owner) -> Bool
    private let read: (Owner) -> Bool?
    private let settable: (Owner) -> Bool
    private let write: (Owner, Bool) -> Bool
    init(current: @escaping () -> Owner?, alive: @escaping (Owner) -> Bool,
         read: @escaping (Owner) -> Bool?, settable: @escaping (Owner) -> Bool,
         write: @escaping (Owner, Bool) -> Bool) {
        self.current = current; self.alive = alive; self.read = read
        self.settable = settable; self.write = write
    }
    private func restore() {
        guard let held = lease else { return }
        if !held.changed || !alive(held.owner) { lease = nil; return }
        // Do not overwrite an independently changed setting. Never write an
        // unknown original, and retain ownership if restoration cannot complete.
        guard let enabled = read(held.owner) else { return }
        if !enabled { lease = nil; return }
        if write(held.owner, false), read(held.owner) == false { lease = nil }
    }
    private func expired(_ held: Lease, now: UInt64) -> Bool {
        // Calls capture time before taking the lock and can arrive out of order.
        now >= held.lastSample && now - held.lastSample >= 3000
    }
    func observe(_ owner: Owner, now: UInt64) {
        lock.lock(); defer { lock.unlock() }
        if let held = lease, held.owner != owner || current() != owner || expired(held, now: now) { restore() }
        guard current() == owner else { return }
        if let held = lease {
            if held.owner == owner { lease?.lastSample = max(held.lastSample, now) }
            return
        }
        guard let original = read(owner) else { return }
        if original { lease = Lease(owner: owner, changed: false, lastSample: now); return }
        guard settable(owner), current() == owner else { return }
        // Record ownership before the write so even a failed acknowledgement has
        // a restoration path. Unknown/missing attributes never reach this point.
        lease = Lease(owner: owner, changed: true, lastSample: now)
        if !write(owner, true) || current() != owner { restore() }
    }
    func validate(now: UInt64) {
        lock.lock(); defer { lock.unlock() }
        if let held = lease, current() != held.owner || expired(held, now: now) { restore() }
    }
    func retire() { lock.lock(); defer { lock.unlock() }; restore() }
}
