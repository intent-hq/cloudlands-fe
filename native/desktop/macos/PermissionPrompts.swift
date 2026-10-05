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
