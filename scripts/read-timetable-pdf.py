"""Read the printed cell boundaries of timetable PDFs. Coordinates include merged cells."""
import io
import json
import sys
from statistics import median

import pdfplumber


def extract(page):
    heights = [c["height"] for c in page.chars if c["text"].isalpha()]
    # Small Excel printouts can fit two lines of type into two PDF points.
    tolerance = min(2, median(heights) / 6) if heights else 1
    tables = page.find_tables()
    if not tables:
        # Some Excel printouts fit a whole week on a very small page.
        tables = page.find_tables({key: 1 for key in (
            "snap_tolerance", "intersection_tolerance", "join_tolerance", "edge_min_length"
        )})
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
            left, top, right, bottom, _ = frame
            inside = (other for other in cells if other is not frame and
                      left <= other[0] and top <= other[1] and
                      right >= other[2] and bottom >= other[3] and
                      other[2] - other[0] > 1 and other[3] - other[1] > 1)
            return next(inside, None) is not None and next(inside, None) is not None

        result.append([cell for cell in cells if not encloses_activities(cell)])
    return {"text": page.extract_text() or "", "tables": result}


with pdfplumber.open(io.BytesIO(sys.stdin.buffer.read())) as doc:
    json.dump([extract(page) for page in doc.pages], sys.stdout, ensure_ascii=False)
