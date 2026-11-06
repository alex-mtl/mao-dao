"""Does the computer that shows the overlay (TikTok LIVE Studio) meet the game's requirements?

The overlay reports what the browser can see: the WebGL renderer (the graphics card that draws it),
logical processors and memory (Chrome reports at most 8 GB, so only less than 8 can be seen).
Unknown cards pass: the panel warns only about hardware known to be too weak.

Requirements (owner's decision 2026-11-06): Windows 10/11, Intel Core i5 10th gen / Ryzen 5 3000 or
newer with at least 8 threads, 16 GB of memory, a graphics card not weaker than Intel Iris Xe /
AMD Radeon 680M / NVIDIA GTX 1650 / AMD RX 6500.
"""
import re

MIN_THREADS = 8
MIN_MEMORY_GB = 8          # the most a browser reports; 16 GB can't be checked from a page

# graphics drawn by the processor, or cards below Iris Xe / GTX 1650
WEAK_GPU = [re.compile(p, re.I) for p in (
    r"swiftshader", r"basic render", r"llvmpipe", r"software", r"^no webgl",
    r"intel.*\b(u?hd) graphics",                  # HD / UHD (incl. UHD 620/630/7xx), not Iris
    r"nvidia.*\bmx\s?\d+",                        # MX110 ... MX550
    r"nvidia.*geforce\s+(gt|gts)\s?\d+",          # GT 710, GT 1030 ...
    r"nvidia.*geforce\s+gtx\s?(\d{3})\b",         # GTX 750 / 960 ... (three digits = before 10xx)
    r"nvidia.*geforce\s+gtx\s?10[1-5]0",          # GTX 1050 (Ti) and lower
    r"nvidia.*quadro\s+(k|p[1-6]00\b)",           # old / entry Quadro
    r"amd.*radeon.*\b(r[2-7])\b",                 # Radeon R5 / R7 APUs
    r"amd.*radeon.*vega\s?(3|6|8|10|11)\b",       # Ryzen APUs before 680M
    r"amd.*radeon.*\bhd\s?\d{4}",                 # Radeon HD 7xxx and older
    r"amd.*radeon.*\brx\s?(4[0-6]0|5[0-5]0)\b",   # RX 460 / 550 / 560 class
)]


def gpu_name(renderer):
    """'ANGLE (NVIDIA, NVIDIA GeForce MX110 (0x0000174E) Direct3D11 ...)' -> 'NVIDIA GeForce MX110'"""
    s = str(renderer or "").strip()
    m = re.match(r"ANGLE \(([^,]*),\s*(.+?)(\s*\(0x[0-9a-f]+\))?\s*(Direct3D|OpenGL|Vulkan|Metal)", s, re.I)
    if m:
        s = m.group(2)
    return re.sub(r"\((R|TM)\)", "", s, flags=re.I).replace("  ", " ").strip()[:80]


def check(hw):
    """hw = {gpu, cores, mem} from the overlay -> what is below the requirements:
    [{"part": "gpu"|"cpu"|"mem", "value": "..."}] (empty when nothing is known to be weak)."""
    problems = []
    renderer = str(hw.get("gpu") or "")
    if renderer and any(p.search(renderer) for p in WEAK_GPU):
        problems.append({"part": "gpu", "value": gpu_name(renderer) or renderer[:80]})
    try:
        cores = int(hw.get("cores") or 0)
    except (TypeError, ValueError):
        cores = 0
    if 0 < cores < MIN_THREADS:
        problems.append({"part": "cpu", "value": str(cores)})
    try:
        mem = float(hw.get("mem") or 0)
    except (TypeError, ValueError):
        mem = 0
    if 0 < mem < MIN_MEMORY_GB:
        problems.append({"part": "mem", "value": f"{mem:g}"})
    return problems
