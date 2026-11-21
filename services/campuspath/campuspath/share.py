"""A route's address as a QR code, for a phone to pick up from a screen, a timetable or a door."""

import re
from urllib.parse import parse_qsl, urlsplit

import cv2
import numpy

# What a route address may carry. See "Run locally" in the README.
FIELDS = {"from", "to", "dest", "lang"}
# Where a route opens: this app's home page, or the campus page of an app that embeds the planner
# behind a proxy, which passes its public host on in the Host header.
PATHS = {"", "/", "/campus"}
# Longer addresses make codes too dense to scan from a screen. Real routes stay under 400.
LONGEST = 600
# The standard asks for four modules of white on every side.
QUIET = 4
# Pixels per module in the PNG: 400 to 800 pixels across for a route address.
SCALE = 12


def route_link(link, host):
    """Return `link` if it is the address of a route in the app served at `host`.

    The endpoint makes codes for this app alone, so that it cannot be used to dress up a link to
    somewhere else. `host` is the Host header of the request: behind a proxy, the public host.
    """
    link = (link or "").strip()
    if not link:
        raise ValueError("Send the route's address as `link`.")
    if len(link) > LONGEST:
        raise ValueError(f"The address is longer than {LONGEST} characters.")
    if not link.isascii() or re.search(r"[\s\x00-\x1f\x7f]", link):
        raise ValueError("Percent-encode the address.")
    try:
        parts = urlsplit(link)
        fields = parse_qsl(parts.query, keep_blank_values=True)
    except ValueError:
        raise ValueError("The address cannot be read.") from None
    if parts.scheme not in ("http", "https") or parts.netloc.lower() != (host or "").lower():
        raise ValueError("The address must be one of this app's own.")
    if parts.path not in PATHS or parts.fragment or any(key not in FIELDS for key, _ in fields):
        raise ValueError("The address must be a route: `from`, `to`, `dest` and `lang` on the home page or /campus.")
    return link


def modules(link):
    """The code as rows of booleans, True where a module is dark, with its quiet zone."""
    params = cv2.QRCodeEncoder_Params()
    # Level M recovers 15% of the code: enough for a screen, without the density of Q and H.
    params.correction_level = cv2.QRCodeEncoder_CORRECT_LEVEL_M
    dark = cv2.QRCodeEncoder_create(params).encode(link) < 128
    # OpenCV adds a border of its own. The three finder patterns reach the symbol's edges, so the
    # dark modules bound it exactly.
    rows, columns = numpy.flatnonzero(dark.any(axis=1)), numpy.flatnonzero(dark.any(axis=0))
    symbol = dark[rows[0]:rows[-1] + 1, columns[0]:columns[-1] + 1]
    return numpy.pad(symbol, QUIET)


def svg(link):
    grid = modules(link)
    size = len(grid)
    runs = []
    for y, row in enumerate(grid):
        # One rectangle per horizontal run of dark modules.
        edges = numpy.flatnonzero(numpy.diff(numpy.concatenate(([0], row.view(numpy.int8), [0]))))
        runs += [f"M{start} {y}h{end - start}v1h-{end - start}z" for start, end in zip(edges[::2], edges[1::2])]
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {size} {size}" '
        f'width="{size * SCALE}" height="{size * SCALE}" shape-rendering="crispEdges">'
        f'<rect width="{size}" height="{size}" fill="#fff"/><path fill="#000" d="{"".join(runs)}"/></svg>'
    )


def png(link):
    picture = numpy.where(modules(link), 0, 255).astype(numpy.uint8)
    picture = cv2.resize(picture, None, fx=SCALE, fy=SCALE, interpolation=cv2.INTER_NEAREST)
    done, data = cv2.imencode(".png", picture)
    if not done:
        raise RuntimeError("The code could not be written as a PNG.")
    return data.tobytes()
