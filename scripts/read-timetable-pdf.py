"""Read the printed cell boundaries of timetable PDFs. Coordinates include merged cells."""
import io
import json
import sys
from statistics import median

import pdfplumber


def is_fill(obj):
    """A cell's background: a filled box that is not a border drawn as a thin bar."""
    return (obj["object_type"] == "rect" and obj.get("fill") and not obj.get("stroke")
            and min(obj["width"], obj["height"]) >= 1.5)


def merged_fills(page):
    """A coloured cell that spans several rows is painted as one box per row, with no line
    between them. Read as borders, those inner edges cut a three-hour class into pieces, one
    per printed line. Stack the boxes of one colour back into the cell they paint, so that only
    its outline remains. Where a colour meets another, the edge is kept: some printouts draw no
    line there at all."""
    columns = {}
    for rect in page.rects:
        if is_fill(rect):
            key = (str(rect.get("non_stroking_color")), round(rect["x0"]), round(rect["x1"]))
            columns.setdefault(key, []).append(rect)
    merged = []
    for boxes in columns.values():
        boxes.sort(key=lambda r: r["top"])
        current = dict(boxes[0])
        for box in boxes[1:]:
            if box["top"] <= current["bottom"] + 0.5:
                current["bottom"] = max(current["bottom"], box["bottom"])
            else:
                merged.append(current)
                current = dict(box)
        merged.append(current)
    for box in merged:
        box["height"] = box["bottom"] - box["top"]
        box["y0"], box["y1"] = page.height - box["bottom"], page.height - box["top"]
    return merged


def extract(page):
    fills = merged_fills(page)
    outlines = {"explicit_vertical_lines": fills, "explicit_horizontal_lines": fills}
    page = page.filter(lambda obj: not is_fill(obj))
    heights = [c["height"] for c in page.chars if c["text"].isalpha()]
    # Small Excel printouts can fit two lines of type into two PDF points.
    tolerance = min(2, median(heights) / 6) if heights else 1
    tables = page.find_tables(outlines)
    if not tables:
        # Some Excel printouts fit a whole week on a very small page.
        tables = page.find_tables({**outlines, **{key: 1 for key in (
            "snap_tolerance", "intersection_tolerance", "join_tolerance", "edge_min_length"
        )}})
    result = []
    for table in tables:
        cells = []
        for row, values in zip(table.rows, table.extract(x_tolerance=1, y_tolerance=tolerance)):
            for rect, value in zip(row.cells, values):
                if rect and value and value.strip():
                    cells.append([*(round(n, 2) for n in rect), value.strip()])
        # An outer frame may enclose several individually bordered activities.
        # pdfplumber returns its text again as a single, overlapping cell.
        def encloses_activities(frame):
            left, top, right, bottom, text = frame
            inside = (other for other in cells if other is not frame and
                      left <= other[0] and top <= other[1] and
                      right >= other[2] and bottom >= other[3] and
                      other[2] - other[0] > 1 and other[3] - other[1] > 1)
            first = next(inside, None)
            return first is not None and (
                " ".join(first[4].split()) == " ".join(text.split()) or next(inside, None) is not None
            )

        result.append([cell for cell in cells if not encloses_activities(cell)])
    return {"text": page.extract_text() or "", "tables": result}


with pdfplumber.open(io.BytesIO(sys.stdin.buffer.read())) as doc:
    json.dump([extract(page) for page in doc.pages], sys.stdout, ensure_ascii=False)
