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
//        intent-keychain-helper delete <account>
//
// Accounts are backend identity keys (not secret); payloads/secrets travel
// over stdin/stdout only — NEVER argv. Prints a single JSON object to stdout:
//   list:    {"items": [{"account": "...", "payload": "...", "modifiedAtMs": 123}]}
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
func baseQuery(account: String? = nil) -> [String: Any] {
    var query: [String: Any] = [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: service,
        kSecUseDataProtectionKeychain as String: true,
        kSecAttrSynchronizable as String: kSecAttrSynchronizableAny,
    ]
    if let account = account {
        query[kSecAttrAccount as String] = account
    }
    return query
}

func runList() -> Never {
    var query = baseQuery()
    query[kSecMatchLimit as String] = kSecMatchLimitAll
    query[kSecReturnAttributes as String] = true
    query[kSecReturnData as String] = true
    var result: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &result)
    if status == errSecItemNotFound {
        emit(["items": [[String: Any]]()], exitCode: 0)
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
        items.append(item)
    }
    emit(["items": items], exitCode: 0)
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
    var add = baseQuery(account: account)
    // Written explicitly synchronizable (the whole point of this helper) and
    // readable after first unlock so a background reconcile pass works.
    add[kSecAttrSynchronizable as String] = true
    add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
    add[kSecValueData as String] = payloadData
    var status = SecItemAdd(add as CFDictionary, nil)
    if status == errSecDuplicateItem {
        let update = [kSecValueData as String: payloadData]
        status = SecItemUpdate(baseQuery(account: account) as CFDictionary, update as CFDictionary)
    }
    guard status == errSecSuccess else {
        failKeychain(status, "upsert")
    }
    emit(["ok": true], exitCode: 0)
}

func runDelete(account: String) -> Never {
    let status = SecItemDelete(baseQuery(account: account) as CFDictionary)
    guard status == errSecSuccess else {
        failKeychain(status, "delete")
    }
    emit(["ok": true], exitCode: 0)
}

let arguments = Array(CommandLine.arguments.dropFirst())
guard let command = arguments.first else {
    fail("bad-arguments", "usage: intent-keychain-helper <list | upsert <account> | delete <account>>")
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
    guard arguments.count == 2, !arguments[1].isEmpty else {
        fail("bad-arguments", "usage: intent-keychain-helper delete <account>")
    }
    runDelete(account: arguments[1])
default:
    fail("bad-arguments", "unknown subcommand \"\(command)\" (expected list, upsert, or delete)")
}
