// Pure prompt policy: checks never imply grants; only a new local Allow gesture
// calls this policy. Request one missing permission at a time and never loop on
// denial. macOS owns its dialogs and any required relaunch.
struct PermissionPrompts {
    enum Prompt { case accessibility, screenRecording }
    private var accessibilityRequested = false
    private var screenRecordingRequested = false
    mutating func next(accessibility: Bool, screenRecording: Bool) -> Prompt? {
        if !accessibility {
            guard !accessibilityRequested else { return nil }
            accessibilityRequested = true
            return .accessibility
        }
        if !screenRecording {
            guard !screenRecordingRequested else { return nil }
            screenRecordingRequested = true
            return .screenRecording
        }
        return nil
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
