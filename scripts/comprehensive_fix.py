#!/usr/bin/env python3

import re
import os
from pathlib import Path


def find_handler_end(lines, start_idx):
    """Find where a createSafeValidatedHandler call ends"""
    paren_count = 0
    brace_count = 0
    in_handler = False

    for i in range(start_idx, len(lines)):
        line = lines[i]

        # Start counting when we see createSafeValidatedHandler
        if "createSafeValidatedHandler(" in line or "createValidatedHandler(" in line:
            in_handler = True

        if in_handler:
            paren_count += line.count("(") - line.count(")")
            brace_count += line.count("{") - line.count("}")

            # Handler ends when we're back to baseline
            if in_handler and paren_count <= 0 and brace_count <= 0:
                # Check if this line ends with })
                if re.search(r"\}\s*\)\s*,?\s*$", line):
                    return i
                # Or if next line has the closing
                if i + 1 < len(lines) and re.search(
                    r"^\s*\}\s*\)\s*,?\s*$", lines[i + 1]
                ):
                    return i + 1

    return -1


def fix_all_handlers_in_file(file_path):
    """Fix all handlers in a single file"""

    if not file_path.exists():
        return 0

    with open(file_path, "r") as f:
        lines = f.readlines()

    fixes = 0
    i = 0

    while i < len(lines):
        line = lines[i]

        # Look for ipcMain.handle pattern
        if "ipcMain.handle(" in line and not line.strip().startswith("//"):
            # Extract the channel
            channel_match = re.search(
                r"ipcMain\.handle\s*\(\s*([A-Z_]+(?:_CHANNELS)?\.[A-Z_]+)", line
            )
            if channel_match:
                channel = channel_match.group(1)

                # Find createSafeValidatedHandler on next lines
                handler_line = -1
                for j in range(i + 1, min(i + 5, len(lines))):
                    if (
                        "createSafeValidatedHandler(" in lines[j]
                        or "createValidatedHandler(" in lines[j]
                    ):
                        handler_line = j
                        break

                if handler_line != -1:
                    # Find where the handler ends
                    end_line = find_handler_end(lines, handler_line)

                    if end_line != -1:
                        # Check if channel is already there
                        handler_text = "".join(lines[handler_line : end_line + 1])

                        # Look for the channel already being present
                        if not re.search(
                            r",\s*" + re.escape(channel) + r"\s*\)", handler_text
                        ):
                            # Add the channel before the closing parenthesis
                            last_line = lines[end_line]

                            # Find where to insert - before the last )
                            match = re.search(r"(\}\s*)\)", last_line)
                            if match:
                                insert_pos = match.start(1) + len(match.group(1))
                                lines[end_line] = (
                                    last_line[:insert_pos]
                                    + ", "
                                    + channel
                                    + last_line[insert_pos:]
                                )
                                fixes += 1
                            elif re.search(r"\)\s*,?\s*$", last_line):
                                # Simple case - just a closing paren
                                last_line = last_line.rstrip()
                                if last_line.endswith("),"):
                                    lines[end_line] = (
                                        last_line[:-2] + ", " + channel + "),\n"
                                    )
                                elif last_line.endswith(")"):
                                    lines[end_line] = (
                                        last_line[:-1] + ", " + channel + "),\n"
                                    )
                                else:
                                    # Insert before the last )
                                    idx = last_line.rfind(")")
                                    if idx != -1:
                                        lines[end_line] = (
                                            last_line[:idx]
                                            + ", "
                                            + channel
                                            + last_line[idx:]
                                        )
                                fixes += 1

                    i = end_line + 1 if end_line != -1 else i + 1
                else:
                    i += 1
            else:
                i += 1
        else:
            i += 1

    if fixes > 0:
        with open(file_path, "w") as f:
            f.writelines(lines)

    return fixes


def main():
    print("🔧 Comprehensive IPC Channel Fix...\n")

    base_dir = Path(__file__).parent.parent / "src/features"

    # Find all .ipc.ts files
    ipc_files = list(base_dir.rglob("*.ipc.ts"))
    ipc_files.extend(list(base_dir.rglob("**/init-unified-backend.ts")))

    total_fixes = 0
    fixed_files = []

    for file_path in ipc_files:
        fixes = fix_all_handlers_in_file(file_path)
        if fixes > 0:
            total_fixes += fixes
            fixed_files.append((file_path.name, fixes))
            print(f"✅ Fixed {fixes} handlers in {file_path.name}")

    print("\n📊 Summary:")
    print(f"Files processed: {len(ipc_files)}")
    print(f"Total fixes: {total_fixes}")

    if fixed_files:
        print("\nFixed files:")
        for name, count in fixed_files:
            print(f"  {name}: {count} handlers")


if __name__ == "__main__":
    main()
