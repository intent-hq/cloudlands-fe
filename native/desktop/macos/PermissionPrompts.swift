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
    private var started = false
    mutating func observe(requestId: String, granted: Bool, now: UInt64) -> UInt64? {
        if self.requestId != requestId {
            self.requestId = requestId; generation += 1; started = false; state = "unavailable"
        }
        lastPoll = now
        if !granted {
            if started { generation += 1 }
            started = false; state = "unavailable"
            return nil
        }
        guard !started else { return nil }
        started = true; generation += 1; state = "pending"
        return generation
    }
    mutating func complete(_ token: UInt64, ready: Bool) {
        guard token == generation, state == "pending" else { return }
        state = ready ? "ready" : "unavailable"
    }
    mutating func expire(now: UInt64) -> Bool {
        guard started, state == "pending", now - lastPoll >= 3000 else { return false }
        generation += 1; state = "unavailable"
        return true
    }
}
