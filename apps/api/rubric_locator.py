import io
import re

import pdfplumber

# find where each verbatim option lives in the pdf so the ui can highlight it.
# match the option's word-run against the page words and union their boxes into
# rectangles (one per wrapped line). when the same text appears in several places
# (e.g. two essay rows sharing "Incomplete or off-topic", or GPA bands repeating
# across columns), each criterion claims the spot nearest its own region and marks
# it used, so siblings can't collide onto the same occurrence. coords are top-left
# origin in pdf points — same axis as css.

MIN_ANCHOR_TOKENS = 5
MAX_ANCHOR_TOKENS = 14
MIN_SEG_CHARS = 10  # shortest char run worth highlighting on its own
ROW_GAP = 3  # points; a bigger jump in 'top' means a new wrapped line


def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip()


def _alnum(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", s.lower())


# per page: the words' letters as one space-free stream, plus char index -> word
# index, so labels still match where the pdf text layer glues words together
def _build_streams(pagewords) -> list[tuple[str, list[int]]]:
    streams = []
    for words in pagewords:
        chars, idx = [], []
        for wi, w in enumerate(words):
            for ch in _alnum(w["text"]):
                chars.append(ch)
                idx.append(wi)
        streams.append(("".join(chars), idx))
    return streams


def _rects_for_run(run: list[dict]) -> list[list[float]]:
    # group the matched words into rows by their vertical position, one rect per row
    rows, cur = [], [run[0]]
    for w in run[1:]:
        if abs(w["top"] - cur[-1]["top"]) > ROW_GAP:
            rows.append(cur)
            cur = [w]
        else:
            cur.append(w)
    rows.append(cur)
    return [
        [
            min(x["x0"] for x in r),
            min(x["top"] for x in r),
            max(x["x1"] for x in r),
            max(x["bottom"] for x in r),
        ]
        for r in rows
    ]


def _centroid(rects: list[list[float]]) -> tuple[float, float]:
    xs = [(r[0] + r[2]) / 2 for r in rects]
    ys = [(r[1] + r[3]) / 2 for r in rects]
    return sum(xs) / len(xs), sum(ys) / len(ys)


def _find_all(pagewords: list[list[dict]], toks: list[str]) -> list[tuple[int, int, int]]:
    hits = []
    n = len(toks)
    for pi, words in enumerate(pagewords):
        wl = [w["text"].lower() for w in words]
        for i in range(len(wl) - n + 1):
            if wl[i : i + n] == toks:
                hits.append((pi, i, n))
    return hits


# every place this label could sit: full-label matches, else the longest window that hits
def _candidates(pagewords: list[list[dict]], label: str) -> list[tuple[int, int, int]]:
    toks = _norm(label).lower().split()
    if not toks:
        return []
    full = _find_all(pagewords, toks)
    if full:
        return full
    n = len(toks)
    for size in range(min(n, MAX_ANCHOR_TOKENS), MIN_ANCHOR_TOKENS - 1, -1):
        collected = []
        for start in range(0, n - size + 1):
            collected += _find_all(pagewords, toks[start : start + size])
        if collected:
            return collected
    return []


def _rects_of(pagewords: list[list[dict]], cand: tuple[int, int, int]) -> list[list[float]]:
    pi, i, size = cand
    return _rects_for_run(pagewords[pi][i : i + size])


def _pick(cands, pagewords, region):
    # choose the candidate closest to the criterion's region; same page wins
    if not cands:
        return None
    if region is None or len(cands) == 1:
        return cands[0]
    pg, rx, ry = region
    def dist(c):
        cx, cy = _centroid(_rects_of(pagewords, c))
        return (c[0] != pg, (cx - rx) ** 2 + (cy - ry) ** 2)
    return min(cands, key=dist)


# when a label has no contiguous word run (a cell split across table rows, or the
# pdf gluing words), match it greedily on the char streams: longest matchable
# prefix, emit that segment, continue with the rest. each segment lands nearest
# the previous one so a duplicated phrase can't yank the highlight across the page.
def _charstream_segments(streams, pagewords, label, region):
    target = _alnum(label)
    segs, pos, anchor = [], 0, region
    while len(target) - pos >= MIN_SEG_CHARS:
        rest = target[pos:]
        lo, hi = 0, len(rest)  # longest prefix present anywhere: binary search
        while lo < hi:
            mid = (lo + hi + 1) // 2
            if any(rest[:mid] in s for s, _ in streams):
                lo = mid
            else:
                hi = mid - 1
        if lo < MIN_SEG_CHARS:
            pos += 1  # unmatchable spot (model paraphrase, ocr junk) — slide past
            continue
        occs = []
        for pi, (s, idx) in enumerate(streams):
            at = s.find(rest[:lo])
            while at >= 0:
                occs.append((pi, idx[at], idx[at + lo - 1] - idx[at] + 1))
                at = s.find(rest[:lo], at + 1)
        pick = _pick(occs, pagewords, anchor)
        cx, cy = _centroid(_rects_of(pagewords, pick))
        anchor = (pick[0], cx, cy)
        segs.append(pick)
        pos += lo
    return segs


def _anchors(cand_map, pagewords) -> list[tuple[int, float, float]]:
    # options that match exactly one full-label spot pin down the criterion's region
    pts = []
    for cands in cand_map:
        if len(cands) == 1:
            x, y = _centroid(_rects_of(pagewords, cands[0]))
            pts.append((cands[0][0], x, y))
    return pts


def _name_region(pagewords, name):
    cands = _candidates(pagewords, name)
    if not cands:
        toks = _norm(name).lower().split()
        for size in range(min(len(toks), 8), 2, -1):
            cands = _find_all(pagewords, toks[:size])
            if cands:
                break
    if not cands:
        return None
    pi = cands[0][0]
    x, y = _centroid(_rects_of(pagewords, cands[0]))
    return (pi, x, y)


# an option table to locate: its own name (for the region fallback) and its options.
# flat criteria give one group; a variants criterion gives one group per level table.
def _option_groups(criteria: list[dict]) -> list[dict]:
    groups = []
    for c in criteria:
        if c.get("options"):
            groups.append({"name": c["name"], "options": c["options"]})
        for v in c.get("variants") or []:
            groups.append({"name": v.get("level") or c["name"], "options": v["options"]})
    return groups


# attach `source` (page + rects) to every option, `question_source` per criterion, and
# `pages` (per-page dims so the ui can scale). mutates + returns the questionnaire.
def attach_sources(pdf_bytes: bytes, questionnaire: dict) -> dict:
    with pdfplumber.open(io.BytesIO(pdf_bytes)) as doc:
        pagewords = [p.extract_words(use_text_flow=True) for p in doc.pages]
        questionnaire["pages"] = [
            {"width": float(p.width), "height": float(p.height)} for p in doc.pages
        ]

    # highlight each criterion's question text (scale criteria have no options to light up)
    for c in questionnaire["criteria"]:
        q = c.get("question")
        if q:
            cands = _candidates(pagewords, q)
            pick = _pick(cands, pagewords, _name_region(pagewords, c["name"]))
            if pick:
                c["question_source"] = {"page": pick[0], "rects": _rects_of(pagewords, pick)}

    criteria = _option_groups(questionnaire["criteria"])
    cand_maps = [[_candidates(pagewords, o["label"]) for o in c["options"]] for c in criteria]

    # region per criterion: centroid of its unique anchors, else where its name sits
    regions = []
    for crit, cand_map in zip(criteria, cand_maps):
        pts = _anchors(cand_map, pagewords)
        region = None
        if pts:
            pg = max(set(p for p, _, _ in pts), key=[p for p, _, _ in pts].count)
            same = [(x, y) for p, x, y in pts if p == pg]
            region = (pg, sum(x for x, _ in same) / len(same), sum(y for _, y in same) / len(same))
        if region is None:
            region = _name_region(pagewords, crit["name"])
        regions.append(region)

    # walk criteria in reading order; each option takes the nearest UNCLAIMED spot so
    # duplicate text never resolves two criteria onto the same occurrence
    order = sorted(
        range(len(criteria)), key=lambda ci: regions[ci] if regions[ci] else (99, 1e9, 1e9)
    )
    claimed = set()
    streams = _build_streams(pagewords)
    for ci in order:
        for o, cands in zip(criteria[ci]["options"], cand_maps[ci]):
            toks = _norm(o["label"]).lower().split()
            if toks and not _find_all(pagewords, toks):
                # no contiguous run in the pdf — highlight it segment by segment
                segs = _charstream_segments(streams, pagewords, o["label"], regions[ci])
                if segs:
                    segs = [s for s in segs if s[0] == segs[0][0]]  # source is one page
                    claimed.add((segs[0][0], segs[0][1]))
                    rects = [r for s in segs for r in _rects_of(pagewords, s)]
                    o["source"] = {"page": segs[0][0], "rects": rects}
                continue
            free = [c for c in cands if (c[0], c[1]) not in claimed]
            pick = _pick(free or cands, pagewords, regions[ci])
            if pick:
                claimed.add((pick[0], pick[1]))
                o["source"] = {"page": pick[0], "rects": _rects_of(pagewords, pick)}
    return questionnaire
