// intent-keychain-helper — iCloud-synchronizable keychain CRUD CLI.
//
// Invoked by the Electron main process to read/write the synced remote-backend
// registry in the user's iCloud Keychain. Electron safeStorage and the
// `security` CLI cannot set kSecAttrSynchronizable, hence this helper.
// Compiled at package time by scripts/build-keychain-helper.cjs into a minimal
// .app bundle (resources/keychain-helper/intent-keychain-helper.app): the
// data-protection keychain requires the RESTRICTED
// com.apple.application-identifier / keychain-access-groups entitlements,
// which must be authorized by an embedded Developer ID provisioning profile,
// and profiles can only be embedded in bundles (see scripts/sign-sidecar.js).
//
// Usage: intent-keychain-helper list
//        intent-keychain-helper upsert <account>   ({"payload": "..."} on stdin)
//        intent-keychain-helper delete <account> [access-group]
//
// Accounts are backend identity keys (not secret); payloads/secrets travel
// over stdin/stdout only — NEVER argv (access groups are entitlement strings,
// not secret). Prints a single JSON object to stdout:
//   list:    {"items": [{"account": "...", "payload": "...", "modifiedAtMs": 123,
//             "group": "..."}], "sharedGroup": "..."}
//            ("group" per item and top-level "sharedGroup" appear only when
//             resolvable; callers use them to migrate legacy default-group items)
//   upsert:  {"ok": true}
//   delete:  {"ok": true}
//   failure: {"error": "<code>", "message": "...", "status": <OSStatus>} with exit code 1
// Error codes:
//   unavailable    — the data-protection keychain rejected the caller
//                    (unsigned/ad-hoc dev build or missing restricted
//                    entitlements: errSecMissingEntitlement / errSecNotAvailable).
//                    Callers must NEVER treat this as "no items".
//   not-found      — the delete target does not exist.
//   bad-arguments  — malformed invocation or stdin payload.
//   keychain-error — any other SecItem failure ("status" carries the OSStatus).
import Foundation
import Security

let service = "com.cloudlands.intent.backends"

// Cross-app shared keychain access group (suffix; the full group is
// TEAMID-prefixed, e.g. "ABCDE12345.dev.intentapp.backends"). Resolved at
// RUNTIME from this process's own code-signature entitlements rather than
// injected at build/sign time: the entitlements are the single source of
// truth for what the embedded provisioning profile actually authorizes, so a
// binary signed with an older profile (no shared group yet) automatically
// degrades to today's default-group behavior with no rebuild and no
// out-of-band configuration to drift.
let sharedGroupSuffix = ".dev.intentapp.backends"

/// keychain-access-groups from our own signature, or [] when unsigned/ad-hoc
/// (dev builds) or the entitlement is absent.
func entitlementAccessGroups() -> [String] {
    guard let task = SecTaskCreateFromSelf(nil),
        let value = SecTaskCopyValueForEntitlement(task, "keychain-access-groups" as CFString, nil),
        let groups = value as? [String]
    else { return [] }
    return groups
}

/// The team-prefixed shared group when the profile authorizes it, else nil
/// (degrade to the default app-identifier group — current behavior).
let sharedGroup: String? = entitlementAccessGroups().first { $0.hasSuffix(sharedGroupSuffix) }

func emit(_ object: [String: Any], exitCode: Int32) -> Never {
    let data = try! JSONSerialization.data(withJSONObject: object)
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write("\n".data(using: .utf8)!)
    exit(exitCode)
}

func fail(_ code: String, _ message: String, status: OSStatus? = nil) -> Never {
    var object: [String: Any] = ["error": code, "message": message]
    if let status = status {
        object["status"] = Int(status)
    }
    emit(object, exitCode: 1)
}

func failKeychain(_ status: OSStatus, _ operation: String) -> Never {
    let message = (SecCopyErrorMessageString(status, nil) as String?) ?? "OSStatus \(status)"
    switch status {
    case errSecMissingEntitlement, errSecNotAvailable:
        fail("unavailable", "\(operation): \(message)", status: status)
    case errSecItemNotFound:
        fail("not-found", "\(operation): \(message)", status: status)
    default:
        fail("keychain-error", "\(operation): \(message)", status: status)
    }
}

/// Attributes shared by every query: our fixed service, the data-protection
/// keychain, and synchronizable matching. Items are only ever written with
/// kSecAttrSynchronizable = true; queries match "any" for robustness.
/// `group` scopes the query to one access group; nil matches every group the
/// entitlements grant (both the default app-identifier group and, once
/// authorized, the shared group — exactly what list/migration need).
func baseQuery(account: String? = nil, group: String? = nil) -> [String: Any] {
    var query: [String: Any] = [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: service,
        kSecUseDataProtectionKeychain as String: true,
        kSecAttrSynchronizable as String: kSecAttrSynchronizableAny,
    ]
    if let account = account {
        query[kSecAttrAccount as String] = account
    }
    if let group = group {
        query[kSecAttrAccessGroup as String] = group
    }
    return query
}

/// Top-level list envelope: advertises the resolved shared group (absent when
/// the profile does not authorize it) so callers can tell "no legacy items"
/// from "shared group not available yet".
func listEnvelope(items: [[String: Any]]) -> [String: Any] {
    var envelope: [String: Any] = ["items": items]
    if let sharedGroup = sharedGroup {
        envelope["sharedGroup"] = sharedGroup
    }
    return envelope
}

func runList() -> Never {
    var query = baseQuery()
    query[kSecMatchLimit as String] = kSecMatchLimitAll
    query[kSecReturnAttributes as String] = true
    query[kSecReturnData as String] = true
    var result: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &result)
    if status == errSecItemNotFound {
        emit(listEnvelope(items: []), exitCode: 0)
    }
    guard status == errSecSuccess else {
        failKeychain(status, "list")
    }
    guard let rows = result as? [[String: Any]] else {
        fail("keychain-error", "list: unexpected result shape from SecItemCopyMatching")
    }
    var items: [[String: Any]] = []
    for row in rows {
        guard let account = row[kSecAttrAccount as String] as? String,
            let data = row[kSecValueData as String] as? Data,
            let payload = String(data: data, encoding: .utf8)
        else { continue }
        var item: [String: Any] = ["account": account, "payload": payload]
        if let modified = row[kSecAttrModificationDate as String] as? Date {
            item["modifiedAtMs"] = Int(modified.timeIntervalSince1970 * 1000)
        }
        if let group = row[kSecAttrAccessGroup as String] as? String {
            item["group"] = group
        }
        items.append(item)
    }
    emit(listEnvelope(items: items), exitCode: 0)
}

func readStdinPayload() -> Data {
    let input = FileHandle.standardInput.readDataToEndOfFile()
    guard let object = try? JSONSerialization.jsonObject(with: input) as? [String: Any],
        let payload = object["payload"] as? String,
        !payload.isEmpty
    else {
        fail("bad-arguments", "upsert expects {\"payload\": \"<non-empty string>\"} on stdin")
    }
    return payload.data(using: .utf8)!
}

func runUpsert(account: String) -> Never {
    let payloadData = readStdinPayload()
    // Writes target the SHARED group when the profile authorizes it (so iOS
    // sees them), else the default app-identifier group — current behavior.
    var add = baseQuery(account: account, group: sharedGroup)
    // Written explicitly synchronizable (the whole point of this helper) and
    // readable after first unlock so a background reconcile pass works.
    add[kSecAttrSynchronizable as String] = true
    add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
    add[kSecValueData as String] = payloadData
    var status = SecItemAdd(add as CFDictionary, nil)
    if status == errSecDuplicateItem {
        let update = [kSecValueData as String: payloadData]
        status = SecItemUpdate(
            baseQuery(account: account, group: sharedGroup) as CFDictionary,
            update as CFDictionary)
    }
    guard status == errSecSuccess else {
        failKeychain(status, "upsert")
    }
    emit(["ok": true], exitCode: 0)
}

/// `group` scopes the delete to one access group (migration removes only the
/// legacy default-group copy); nil deletes the account from every group.
func runDelete(account: String, group: String?) -> Never {
    let status = SecItemDelete(baseQuery(account: account, group: group) as CFDictionary)
    guard status == errSecSuccess else {
        failKeychain(status, "delete")
    }
    emit(["ok": true], exitCode: 0)
}

let arguments = Array(CommandLine.arguments.dropFirst())
guard let command = arguments.first else {
    fail("bad-arguments", "usage: intent-keychain-helper <list | upsert <account> | delete <account> [access-group]>")
}
switch command {
case "list":
    guard arguments.count == 1 else {
        fail("bad-arguments", "usage: intent-keychain-helper list")
    }
    runList()
case "upsert":
    guard arguments.count == 2, !arguments[1].isEmpty else {
        fail("bad-arguments", "usage: intent-keychain-helper upsert <account> ({\"payload\": \"...\"} on stdin)")
    }
    runUpsert(account: arguments[1])
case "delete":
    guard arguments.count == 2 || arguments.count == 3, !arguments[1].isEmpty else {
        fail("bad-arguments", "usage: intent-keychain-helper delete <account> [access-group]")
    }
    let group = arguments.count == 3 ? arguments[2] : nil
    if let group = group, group.isEmpty {
        fail("bad-arguments", "usage: intent-keychain-helper delete <account> [access-group]")
    }
    runDelete(account: arguments[1], group: group)
default:
    fail("bad-arguments", "unknown subcommand \"\(command)\" (expected list, upsert, or delete)")
}
