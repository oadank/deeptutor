import json
from pathlib import Path

base = Path(r"C:\D\opt\deeptutor")

# README: keep fork version
readme = base / "README.md"
text = readme.read_text(encoding="utf-8")
import re
new = re.sub(
    r"<<<<<<< HEAD\n(.*?)=======\n.*?>>>>>>> v1\.6\.8\n",
    r"\1",
    text,
    flags=re.S,
)
if "<<<<<<<" not in new:
    readme.write_text(new, encoding="utf-8", newline="\n")
    print("OK README")
else:
    print("WARN README conflicts remain")

for loc in ("en", "zh"):
    path = base / f"web/locales/{loc}/app.json"
    raw = path.read_text(encoding="utf-8")

    # If still has conflict markers, keep both sides
    if "<<<<<<<" in raw:
        raw = re.sub(
            r"<<<<<<< HEAD\n(.*?)=======\n(.*?)>>>>>>> v1\.6\.8\n",
            r"\1\2",
            raw,
            flags=re.S,
        )
        print(f"  resolved markers in {loc}")

    # Fix missing comma when joining HEAD last line + THEIRS first line
    # Pattern: a JSON key line without trailing comma immediately followed by another "key":
    lines = raw.splitlines(keepends=True)
    fixed = []
    for i, line in enumerate(lines):
        stripped = line.rstrip("\r\n")
        # if this looks like a complete "key": "value" line without trailing comma
        # and next non-empty line starts a new key, add comma
        if (
            stripped.endswith('"')
            and not stripped.endswith('",')
            and not stripped.endswith("{")
            and not stripped.startswith("//")
            and i + 1 < len(lines)
        ):
            nxt = lines[i + 1].strip()
            if nxt.startswith('"') and '":' in nxt:
                nl = "\r\n" if line.endswith("\r\n") else "\n" if line.endswith("\n") else ""
                stripped = stripped + ","
                line = stripped + nl
        fixed.append(line)

    out = "".join(fixed)
    # also ensure no conflict markers remain
    if "<<<<<<<" in out or ">>>>>>>" in out:
        print(f"WARN markers remain in {loc}")

    path.write_text(out, encoding="utf-8", newline="\n")
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        print(f"OK {loc}: {len(data)} keys")
    except json.JSONDecodeError as e:
        print(f"FAIL {loc}: {e}")
        # show context
        lines2 = path.read_text(encoding="utf-8").splitlines()
        for ln in range(max(0, e.lineno - 3), min(len(lines2), e.lineno + 2)):
            print(f"{ln+1}: {lines2[ln][:120]}")
