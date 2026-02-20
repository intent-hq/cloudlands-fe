#!/usr/bin/env python3

import re
import os
from pathlib import Path


def fix_ipc_file(file_path, channel_prefix):
    """Fix IPC handlers in a file by adding channel names"""

    if not file_path.exists():
        print(f"⚠️  File not found: {file_path}")
        return 0

    with open(file_path, "r") as f:
        lines = f.readlines()

    fixed_lines = []
    fixes = 0
    i = 0

    while i < len(lines):
        line = lines[i]

        # Check if this line has ipcMain.handle
        if "ipcMain.handle(" in line and not line.strip().startswith("//"):
            # Extract channel from this line
            channel_match = re.search(
                r'ipcMain\.handle\s*\(\s*([A-Z_]+(?:_CHANNELS)?\.[A-Z_]+|[\'"][^\'"]+[\'"])',
                line,
            )
            if channel_match:
                channel = channel_match.group(1)
                fixed_lines.append(line)
                i += 1

                # Look for createSafeValidatedHandler on next line or within a few lines
                handler_start = -1
                for j in range(i, min(i + 3, len(lines))):
                    if (
                        "createSafeValidatedHandler(" in lines[j]
                        or "createValidatedHandler(" in lines[j]
                    ):
                        handler_start = j
                        break

                if handler_start != -1:
                    # Collect the handler lines
                    handler_lines = []
                    paren_count = 0
                    for j in range(handler_start, len(lines)):
                        handler_lines.append(lines[j])
                        paren_count += lines[j].count("(") - lines[j].count(")")
                        if j == handler_start:
                            paren_count = max(
                                1, paren_count
                            )  # Ensure we start with at least 1
                        if paren_count == 0:
                            break

                    # Check if channel is already added
                    handler_text = "".join(handler_lines)
                    # Look for pattern like ", CHANNEL)" or ", 'channel')"
                    has_channel = re.search(
                        r",\s*(?:" + re.escape(channel) + r'|[\'"][^\'"]+[\'"])\s*\)',
                        handler_text,
                    )

                    if not has_channel:
                        # Add channel before the last closing parenthesis of the handler
                        last_line_idx = len(handler_lines) - 1
                        last_line = handler_lines[last_line_idx]

                        # Find the position to insert the channel
                        # Look for pattern like "})" or "),)" or just ")"
                        insert_match = re.search(
                            r"(\}\s*\)|,\s*\)|\))\s*,?\s*$", last_line
                        )
                        if insert_match:
                            insert_pos = insert_match.start(1)
                            handler_lines[last_line_idx] = (
                                last_line[:insert_pos]
                                + ", "
                                + channel
                                + last_line[insert_pos:]
                            )
                            fixes += 1

                    fixed_lines.extend(handler_lines)
                    i = handler_start + len(handler_lines)
                else:
                    # No handler found, just continue
                    continue
            else:
                fixed_lines.append(line)
                i += 1
        else:
            fixed_lines.append(line)
            i += 1

    if fixes > 0:
        with open(file_path, "w") as f:
            f.writelines(fixed_lines)
        print(f"✅ Fixed {fixes} handlers in {file_path.name}")

    return fixes


def main():
    print("🔧 Fixing ALL IPC Channel Names...\n")

    base_dir = Path(__file__).parent.parent / "src"

    # Files to fix with their channel prefixes
    files_to_fix = [
        ("features/workspace/main/workspace.ipc.ts", "WORKSPACE_CHANNELS"),
        ("features/workspace/main/first-visit-state.ipc.ts", "FIRST_VISIT_CHANNELS"),
        ("features/testing/testing.ipc.ts", "TESTING_CHANNELS"),
        ("features/terminal/terminal.ipc.ts", "TERMINAL_CHANNELS"),
        ("features/terminal/main/terminal-professional.ipc.ts", "TERMINAL_CHANNELS"),
        ("features/system/main/system.ipc.ts", ""),  # Multiple channel types
        ("features/rules/user-rules.ipc.ts", "USER_RULES_CHANNELS"),
        ("features/rules/rules.ipc.ts", "RULES_CHANNELS"),
        ("features/remote-fs/main/remote-fs.ipc.ts", "REMOTE_FS_CHANNELS"),
        ("features/notes/notes.ipc.ts", "NOTES_CHANNELS"),
        ("features/notes/main/line-attribution.ipc.ts", "LINE_ATTRIBUTION_CHANNELS"),
        ("features/memories/memories.ipc.ts", "MEMORIES_CHANNELS"),
        ("features/line-changes/line-changes.ipc.ts", "LINE_CHANGES_CHANNELS"),
        ("features/ide/main/ide.ipc.ts", "VSCODE_CHANNELS"),
        ("features/git-tracking/git-tracking.ipc.ts", "GIT_TRACKING_CHANNELS"),
        ("features/git/git.ipc.ts", "GIT_CHANNELS"),
        ("features/file-tracking/main/file-tracking.ipc.ts", "FILE_TRACKING_CHANNELS"),
        ("features/events/events.ipc.ts", "EVENTS_CHANNELS"),
        ("features/events/main/events.ipc.ts", "EVENTS_CHANNELS"),
        ("features/diffs/diffs.ipc.ts", "DIFFS_CHANNELS"),
        ("features/comments/main/comments.ipc.ts", "COMMENTS_CHANNELS"),
        ("features/agent-testing/main/agent-testing.ipc.ts", "AGENT_TESTING_CHANNELS"),
        ("features/agent/main/persistence.ipc.ts", "PERSISTENCE_CHANNELS"),
        ("features/agent/main/init-unified-backend.ts", "WORKSPACE_CHANNELS"),
        ("features/agent/main/config.ipc.ts", "CONFIG_CHANNELS"),
    ]

    total_fixes = 0

    for file_path, channel_prefix in files_to_fix:
        full_path = base_dir / file_path
        fixes = fix_ipc_file(full_path, channel_prefix)
        total_fixes += fixes

    print(f"\n📊 Total fixes applied: {total_fixes}")


if __name__ == "__main__":
    main()
