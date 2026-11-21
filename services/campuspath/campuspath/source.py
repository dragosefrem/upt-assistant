"""Shared locations and downloads for the public tour."""

import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin, urlsplit
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
TOUR = "https://visit360.upt.ro/"
SNAPSHOT = ROOT / "data" / "tour.json"
CACHE = ROOT / ".cache"


def tour_url(path):
    url = urljoin(TOUR, path)
    parts = urlsplit(url)
    if parts.scheme != "https" or parts.netloc != urlsplit(TOUR).netloc:
        raise ValueError("Unexpected tour asset location")
    return url


def fetch(url):
    request = Request(url, headers={"User-Agent": "CampusPath/1.0"})
    for attempt in range(3):
        try:
            with urlopen(request, timeout=18) as response:
                return response.read()
        except HTTPError as exc:
            if exc.code not in (408, 429, 500, 502, 503, 504) or attempt == 2:
                raise
        except (URLError, TimeoutError, ConnectionError):
            if attempt == 2:
                raise
        time.sleep(0.5 * 2**attempt)
