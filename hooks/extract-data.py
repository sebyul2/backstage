#!/usr/bin/env python3
"""Extract tool data summary for C-Team dialogue generation."""
import json, sys, os, re

try:
    data = json.JSONDecoder(strict=False).decode(sys.stdin.read())
except:
    sys.exit(1)

# Load i18n labels
i18n_raw = os.environ.get("_PY_LABELS", "{}")
try:
    i18n = json.loads(i18n_raw).get("python_labels", {})
except:
    i18n = {}

L = lambda k, d="": i18n.get(k, d)

tool = data.get("tool_name", "")
ti = data.get("tool_input", {})
tr = data.get("tool_response", {})

def get_text(r):
    if isinstance(r, str): return r
    if isinstance(r, dict):
        c = r.get("content", [])
        if isinstance(c, list) and len(c) > 0:
            if isinstance(c[0], dict): return c[0].get("text", "")
            return str(c[0])
        if isinstance(c, str): return c
    return ""

resp = get_text(tr)
info = []

if tool == "Read":
    fp = ti.get("file_path", "")
    fn = os.path.basename(fp)
    ext = os.path.splitext(fn)[1]
    lines = resp.split("\n") if resp else []
    lc = len(lines)
    imports = sum(1 for l in lines if "import " in l[:40] or "require(" in l)
    funcs = sum(1 for l in lines if re.match(r".*\b(function |class |def |export (function|class|const) )", l))
    comments = sum(1 for l in lines if l.strip().startswith(("//", "#", "/*", "*")))
    info.append(f"{L('file','File')}: {fn}")
    info.append(f"{lc}{L('lines','lines')}")
    if imports: info.append(f"{L('imports','imports')} {imports}{L('imports_suffix','')}")
    if funcs: info.append(f"{L('funcs','funcs/classes')} {funcs}{L('funcs_suffix','')}")
    if comments == 0 and lc > 50: info.append(L("no_comments","no comments"))
    if ext: info.append(f"{L('type','type')}: {ext}")

elif tool == "Edit":
    fp = ti.get("file_path", "")
    fn = os.path.basename(fp)
    old = ti.get("old_string", "")
    new = ti.get("new_string", "")
    ol = old.count("\n") + (1 if old.strip() else 0)
    nl = new.count("\n") + (1 if new.strip() else 0)
    info.append(f"{L('file','File')}: {fn}")
    info.append(f"-{ol}{L('minus_lines','lines')} +{nl}{L('plus_lines','lines')}")
    d = abs(len(new) - len(old))
    if d < 5: info.append(L("fine_tuning","fine tuning"))
    elif d > 500: info.append(L("large_edit","large edit"))
    for l in new.split("\n"):
        m = re.match(r"\s*(?:function |export (?:function|const|class) |def )(\w+)", l)
        if m:
            info.append(f"{L('function','func')}: {m.group(1)}")
            break

elif tool == "Grep":
    pat = ti.get("pattern", "")[:30]
    lines = [l for l in resp.split("\n") if l.strip()] if resp else []
    mc = len(lines)
    files = set()
    for l in lines:
        if ":" in l: files.add(l.split(":")[0])
    info.append(f"{L('pattern','pattern')}: {pat}")
    info.append(f"{mc}{L('matches','matches')}")
    if files: info.append(f"{len(files)}{L('files_suffix','files')}")

elif tool == "Glob":
    pat = ti.get("pattern", "")[:30]
    lines = [l for l in resp.split("\n") if l.strip()] if resp else []
    fc = len(lines)
    info.append(f"{L('pattern','pattern')}: {pat}")
    info.append(f"{fc}{L('files_suffix','files')}")

elif tool == "Write":
    fp = ti.get("file_path", "")
    fn = os.path.basename(fp)
    content = ti.get("content", "")
    lc = content.count("\n") + (1 if content.strip() else 0)
    ext = os.path.splitext(fn)[1]
    info.append(f"{L('file','File')}: {fn}")
    info.append(f"{lc}{L('lines','lines')}")
    if ext: info.append(f"{L('type','type')}: {ext}")

elif tool == "Bash":
    cmd = ti.get("command", "")[:60]
    last_lines = resp.split("\n")[-5:] if resp else []
    info.append(f"{L('command','cmd')}: {cmd}")
    if "error" in resp[:500].lower(): info.append(L("error_occurred","error occurred"))
    elif "success" in resp[:500].lower(): info.append(L("success","success"))
    elif any("pass" in l.lower() for l in last_lines): info.append(L("test_passed","tests passed"))
    elif any("fail" in l.lower() for l in last_lines): info.append(L("failed","failed"))

print(", ".join(info) if info else "")
