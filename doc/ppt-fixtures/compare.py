#!/usr/bin/env python3
"""把 Python 版的输出目录和 golden/ 逐字节对一遍。

    python3 doc/ppt-fixtures/compare.py doc/ppt-fixtures/golden ./out

退出码 0 = 全对，1 = 有差异（缺文件 / 多文件 / 内容不同都算）。

为什么不用 diff -ru 就完事：JSON 那几份差一个键的时候 diff 的输出很难读，这里对 .json
先解析再逐键比，能直接点出"哪个 key 不一样、两边各是什么"。HTML/TXT 仍然是纯字节比 ——
那几份里空白和换行都是有意义的（`assembleDeck.html` 是要直接落成文件发给别人的）。
"""
import json
import sys
from pathlib import Path

# 这份自己不进对比（它记的是 golden 的哈希，Python 侧没必要复现）。
SKIP = {"MANIFEST.json"}


def flat(obj, prefix=""):
    """把嵌套 JSON 压成 {路径: 值}，这样能报出"第 7 组的 vars.--c-accent 不一样"。"""
    if isinstance(obj, dict):
        out = {}
        for k, v in obj.items():
            out.update(flat(v, f"{prefix}.{k}" if prefix else str(k)))
        return out
    if isinstance(obj, list):
        out = {}
        for i, v in enumerate(obj):
            out.update(flat(v, f"{prefix}[{i}]"))
        return out
    return {prefix: obj}


def show(v, n=120):
    s = json.dumps(v, ensure_ascii=False) if not isinstance(v, str) else v
    s = s.replace("\n", "\\n")
    return s if len(s) <= n else s[:n] + "…"


def cmp_json(name, want_raw, got_raw, problems):
    try:
        want, got = json.loads(want_raw), json.loads(got_raw)
    except json.JSONDecodeError as e:
        problems.append(f"{name}: 不是合法 JSON（{e}）")
        return
    a, b = flat(want), flat(got)
    for k in sorted(set(a) - set(b)):
        problems.append(f"{name}: 少了 {k}（期望 {show(a[k])}）")
    for k in sorted(set(b) - set(a)):
        problems.append(f"{name}: 多了 {k}（实际 {show(b[k])}）")
    for k in sorted(set(a) & set(b)):
        if a[k] != b[k]:
            problems.append(f"{name}: {k}\n    期望 {show(a[k])}\n    实际 {show(b[k])}")


def cmp_text(name, want, got, problems):
    if want == got:
        return
    wl, gl = want.split("\n"), got.split("\n")
    for i in range(max(len(wl), len(gl))):
        w = wl[i] if i < len(wl) else "(文件到这里就结束了)"
        g = gl[i] if i < len(gl) else "(文件到这里就结束了)"
        if w != g:
            problems.append(
                f"{name}: 第 {i + 1} 行起不一样（共 {len(wl)} / {len(gl)} 行）\n"
                f"    期望 {show(w)}\n    实际 {show(g)}"
            )
            return


def main() -> int:
    if len(sys.argv) != 3:
        print(__doc__)
        return 2
    golden, out = Path(sys.argv[1]), Path(sys.argv[2])
    if not golden.is_dir():
        print(f"golden 目录不存在：{golden}")
        return 2
    if not out.is_dir():
        print(f"输出目录不存在：{out}")
        return 2

    want_files = sorted(p.name for p in golden.iterdir() if p.is_file() and p.name not in SKIP)
    got_files = {p.name for p in out.iterdir() if p.is_file()}
    problems: list[str] = []

    for name in want_files:
        if name not in got_files:
            problems.append(f"{name}: 没生成（这一处的实现还没移植）")
            continue
        w = (golden / name).read_text(encoding="utf-8")
        g = (out / name).read_text(encoding="utf-8")
        if name.endswith(".json"):
            cmp_json(name, w, g, problems)
        else:
            cmp_text(name, w, g, problems)

    extra = sorted(got_files - set(want_files) - SKIP)
    for name in extra:
        problems.append(f"{name}: golden 里没有这一份（名字对不上？）")

    if problems:
        print(f"✗ {len(problems)} 处不一样（{len(want_files)} 个样本）\n")
        for p in problems:
            print(f"  - {p}")
        print("\n每一处都对应一类「接口 200、页面看起来正常」的静默事故，不要当成警告放过。")
        return 1

    print(f"✓ {len(want_files)} 个样本全部逐字节一致")
    return 0


if __name__ == "__main__":
    sys.exit(main())
