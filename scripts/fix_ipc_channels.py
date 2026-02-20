#!/usr/bin/env python3

import re
import os
from pathlib import Path


def fix_workspace_ipc():
    """Fix workspace.ipc.ts file"""
    file_path = (
        Path(__file__).parent.parent / "src/features/workspace/main/workspace.ipc.ts"
    )

    with open(file_path, "r") as f:
        content = f.read()

    # Pattern to find ipcMain.handle with createSafeValidatedHandler
    pattern = r"(ipcMain\.handle\s*\(\s*(WORKSPACE_CHANNELS\.[A-Z_]+),\s*createSafeValidatedHandler\([^)]+\),)\s*\)"

    def replace_handler(match):
        handler_content = match.group(1)
        channel = match.group(2)
        # Remove trailing comma if present
        handler_content = handler_content.rstrip(",")
        # Add channel as third parameter
        return f"{handler_content}, {channel}),\n  )"

    # Apply the fix
    fixed_content = re.sub(
        pattern, replace_handler, content, flags=re.MULTILINE | re.DOTALL
    )

    # Write back
    with open(file_path, "w") as f:
        f.write(fixed_content)

    print("Fixed workspace.ipc.ts")


def fix_system_ipc():
    """Fix system.ipc.ts file"""
    file_path = Path(__file__).parent.parent / "src/features/system/main/system.ipc.ts"

    with open(file_path, "r") as f:
        lines = f.readlines()

    fixed_lines = []
    i = 0
    while i < len(lines):
        line = lines[i]

        # Check if this line has ipcMain.handle
        if "ipcMain.handle(" in line and i + 1 < len(lines):
            # Get the channel name
            channel_match = re.search(r"([A-Z_]+_CHANNELS\.[A-Z_]+|\'[^\']+\')", line)
            if channel_match:
                channel = channel_match.group(1)
                fixed_lines.append(line)
                i += 1

                # Look for createSafeValidatedHandler on next line
                if i < len(lines) and "createSafeValidatedHandler(" in lines[i]:
                    # Find the end of the handler
                    handler_lines = [lines[i]]
                    i += 1
                    paren_count = lines[i - 1].count("(") - lines[i - 1].count(")")

                    while i < len(lines) and paren_count > 0:
                        handler_lines.append(lines[i])
                        paren_count += lines[i].count("(") - lines[i].count(")")
                        i += 1

                    # Check if channel is already added
                    handler_text = "".join(handler_lines)
                    if not re.search(
                        r",\s*" + re.escape(channel) + r"\s*\)", handler_text
                    ):
                        # Add channel before the last closing parenthesis
                        last_line = handler_lines[-1]
                        last_paren = last_line.rfind(")")
                        if last_paren != -1:
                            handler_lines[-1] = (
                                last_line[:last_paren]
                                + f", {channel}"
                                + last_line[last_paren:]
                            )

                    fixed_lines.extend(handler_lines)
                else:
                    continue
            else:
                fixed_lines.append(line)
                i += 1
        else:
            fixed_lines.append(line)
            i += 1

    with open(file_path, "w") as f:
        f.writelines(fixed_lines)

    print("Fixed system.ipc.ts")


def main():
    print("🔧 Fixing IPC Channel Names...")

    # Fix workspace.ipc.ts
    try:
        fix_workspace_ipc()
    except Exception as e:
        print(f"Error fixing workspace.ipc.ts: {e}")

    # Fix system.ipc.ts
    try:
        fix_system_ipc()
    except Exception as e:
        print(f"Error fixing system.ipc.ts: {e}")

    print("✅ Done!")


if __name__ == "__main__":
    main()
