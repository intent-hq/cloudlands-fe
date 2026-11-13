// Policy tests, not evidence of TCC dialog display or permission attribution.
var prompts = PermissionPrompts()
precondition(prompts.due(accessibility: false, screenRecording: false) == [.accessibility, .screenRecording], "One Allow gesture asks for every missing permission")
precondition(prompts.due(accessibility: false, screenRecording: false).isEmpty, "Denial must never re-prompt")
precondition(prompts.due(accessibility: true, screenRecording: false).isEmpty, "Screen Recording was already requested")
precondition(prompts.due(accessibility: true, screenRecording: true).isEmpty)
precondition(prompts.due(accessibility: false, screenRecording: true).isEmpty, "A revoked permission is not re-prompted by the same helper")
var screenOnly = PermissionPrompts()
precondition(screenOnly.due(accessibility: true, screenRecording: false) == [.screenRecording])
precondition(screenOnly.due(accessibility: false, screenRecording: false) == [.accessibility], "Each permission is requested at most once")
precondition(screenOnly.due(accessibility: false, screenRecording: false).isEmpty)
var accessibilityOnly = PermissionPrompts()
precondition(accessibilityOnly.due(accessibility: false, screenRecording: true) == [.accessibility])
var trusted = PermissionPrompts()
precondition(trusted.due(accessibility: true, screenRecording: true).isEmpty)
print("PASS: one-gesture permission prompt policy; each permission asked once; denial never loops")
var readiness = PermissionReadiness()
precondition(readiness.observe(requestId: "first", granted: false, now: 0) == nil)
let first = readiness.observe(requestId: "first", granted: true, now: 0)!
for tick in 1...20 {
    precondition(readiness.observe(requestId: "first", granted: true, now: UInt64(tick * 1000)) == nil)
    precondition(!readiness.expire(now: UInt64(tick * 1000)))
    precondition(readiness.state == "pending")
}
readiness.complete(first, ready: true)
precondition(readiness.state == "ready")
let second = readiness.observe(requestId: "second", granted: true, now: 21000)!
readiness.complete(first, ready: true)
precondition(readiness.state == "pending")
precondition(readiness.expire(now: 24000))
readiness.complete(second, ready: true)
precondition(readiness.state == "unavailable")
precondition(readiness.observe(requestId: "second", granted: true, now: 25000) == nil)
let third = readiness.observe(requestId: "third", granted: true, now: 26000)!
precondition(readiness.observe(requestId: "third", granted: false, now: 27000) == nil)
readiness.complete(third, ready: true)
precondition(readiness.state == "unavailable")
print("PASS: delayed SCK readiness, polling cancellation, late completion and successor fencing")
var concurrent = PermissionReadiness()
let owner = concurrent.observe(requestId: "owner", granted: true, now: 0)!
precondition(concurrent.observe(requestId: "other", granted: true, now: 1000) == nil, "A competing request must not replace the pending probe")
precondition(concurrent.generation == owner)
precondition(concurrent.observe(requestId: "owner", granted: true, now: 2000) == nil)
concurrent.complete(owner, ready: true)
let other = concurrent.observe(requestId: "other", granted: true, now: 2001)!
precondition(concurrent.observe(requestId: "owner", granted: true, now: 2002) == nil, "A completed owner must not cancel its successor probe")
precondition(concurrent.generation == other)
concurrent.complete(other, ready: false)
precondition(concurrent.observe(requestId: "other", granted: true, now: 2500) == nil, "Failed observation must not silently retry")
print("PASS: concurrent permission observations retain each request outcome without probe churn")

precondition(concurrent.status(for: "owner") == "ready")
precondition(concurrent.status(for: "other") == "unavailable")
var cancellation = PermissionReadiness()
let abandoned = cancellation.observe(requestId: "abandoned", granted: true, now: 0)!
precondition(cancellation.observe(requestId: "queued", granted: true, now: 2000) == nil)
precondition(cancellation.expire(now: 3000), "Foreign polling must not keep the owner alive")
precondition(cancellation.observe(requestId: "queued", granted: true, now: 4000) == nil, "A canceled OS callback must stay managed until it returns")
precondition(cancellation.status(for: "queued") == "pending")
cancellation.complete(abandoned, ready: true)
precondition(cancellation.status(for: "abandoned") == "unavailable")
let queued = cancellation.observe(requestId: "queued", granted: true, now: 4001)!
cancellation.complete(abandoned, ready: true)
precondition(cancellation.status(for: "queued") == "pending")
cancellation.complete(queued, ready: true)
precondition(cancellation.status(for: "queued") == "ready")
print("PASS: cancellation retains one managed OS callback and never revives abandoned authority")

// Figma readiness owns only its false -> true transition, never an AT-owned true.
var focused: Int? = 1
var flags: [Int: Bool] = [1:false, 2:false]
var writes: [(Int,Bool)] = []
var allowWrite = true
let figma = FigmaAccessibilityReadiness<Int>(
    current: { focused }, alive: { flags[$0] != nil },
    read: { flags[$0] }, settable: { _ in true },
    write: { owner, value in
        writes.append((owner,value))
        if allowWrite { flags[owner] = value }
        return allowWrite
    })
figma.observe(1, now: 0)
precondition(flags[1] == true && writes.count == 1)
for time in stride(from: UInt64(750), through: 6000, by: 750) {
    figma.observe(1, now: time); figma.validate(now: time)
}
precondition(writes.count == 1, "Delayed Chromium readiness must survive short repeated samples")
focused = 2; figma.validate(now: 6001)
precondition(flags[1] == false, "Window/app retarget restores only the previous owner")
figma.observe(2, now: 6002); precondition(flags[2] == true)
figma.validate(now: 9002); precondition(flags[2] == false, "Stopped observations expire")
flags[2] = true
let count = writes.count
figma.observe(2, now: 10000); figma.retire()
precondition(flags[2] == true && writes.count == count, "Preexisting assistive technology is not disabled")
flags[2] = false
figma.observe(2, now: 11000); focused = nil; figma.validate(now: 11001)
precondition(flags[2] == false, "App switch retires readiness")
focused = 1; figma.observe(1, now: 12000); figma.retire()
precondition(flags[1] == false, "Helper EOF/retirement restores ownership")
let unknown = FigmaAccessibilityReadiness<Int>(current: { 1 }, alive: { _ in true }, read: { _ in nil }, settable: { _ in true }, write: { _,_ in preconditionFailure("Unknown original must never be written") })
unknown.observe(1, now: 0); unknown.retire()
let readonly = FigmaAccessibilityReadiness<Int>(current: { 1 }, alive: { _ in true }, read: { _ in false }, settable: { _ in false }, write: { _,_ in preconditionFailure("Unsettable attribute must never be written") })
readonly.observe(1, now: 0); readonly.retire()
figma.observe(1, now: 13000); allowWrite = false; focused = 2
figma.validate(now: 13001); let failedRestoreCount = writes.count
figma.observe(2, now: 13002)
precondition(flags[2] == false && writes.count == failedRestoreCount + 1, "Failed restoration blocks successor acquisition")
allowWrite = true; figma.retire(); precondition(flags[1] == false)
print("PASS: Figma delayed readiness, scope retirement, expiry, original AT state, unavailable attributes and failed restoration fencing")

var readable = true
var restoreFlag = false
var restoreWrites: [Bool] = []
var restoreFocus: Int? = 1
let unreadable = FigmaAccessibilityReadiness<Int>(current: { restoreFocus }, alive: { _ in true },
    read: { _ in readable ? restoreFlag : nil }, settable: { _ in true },
    write: { _, value in restoreWrites.append(value); restoreFlag = value; return true })
unreadable.observe(1, now: 0)
readable = false; restoreFocus = nil
unreadable.validate(now: 1000); unreadable.retire()
precondition(restoreWrites == [true], "An unreadable setting must never be overwritten")
restoreFocus = 2; unreadable.observe(2, now: 1001)
precondition(restoreWrites == [true], "Unreadable restoration must fence the successor")
readable = true; unreadable.retire()
precondition(restoreWrites == [true, false] && !restoreFlag, "Restoration retries once the setting is readable")
print("PASS: unreadable restoration never writes, retains ownership and fences successors")
