import re
import unittest

import cv2
import numpy

from app import create_app
from campuspath import share
from campuspath.routing import Tour

# The test client speaks to the app as "localhost".
ROUTE = "http://localhost/?from=355&to=B527&dest=room%3Aelectro-b527"
ROMANIAN = ROUTE + "&lang=ro"
# The same route on the campus page of an app that serves the planner behind a proxy.
CAMPUS = "https://orar.example.org/campus?from=355&to=B527&dest=room%3Aelectro-b527&lang=ro"
FINDER = numpy.array([[1, 1, 1, 1, 1, 1, 1],
                      [1, 0, 0, 0, 0, 0, 1],
                      [1, 0, 1, 1, 1, 0, 1],
                      [1, 0, 1, 1, 1, 0, 1],
                      [1, 0, 1, 1, 1, 0, 1],
                      [1, 0, 0, 0, 0, 0, 1],
                      [1, 1, 1, 1, 1, 1, 1]], dtype=bool)


def scan(picture):
    """What a scanner reads. OpenCV's reader misses some sound codes, so the tests keep to links it reads."""
    return cv2.QRCodeDetector().detectAndDecode(picture)[0]


def drawn(svg):
    """The modules an SVG code paints, with its side in modules."""
    side = int(re.search(r'viewBox="0 0 (\d+) \1"', svg).group(1))
    grid = numpy.zeros((side, side), dtype=bool)
    for x, y, width in re.findall(r"M(\d+) (\d+)h(\d+)v1", svg):
        grid[int(y), int(x):int(x) + int(width)] = True
    return grid


class ShareTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = create_app(Tour()).test_client()

    def test_code_has_a_quiet_zone_and_three_finder_patterns(self):
        grid = share.modules(ROUTE)
        quiet, side = share.QUIET, len(grid)
        self.assertEqual(grid.shape, (side, side))
        # A symbol is 21 modules across at version 1 and grows by four with each version.
        self.assertEqual((side - 2 * quiet - 21) % 4, 0)
        for edge in (grid[:quiet], grid[-quiet:], grid[:, :quiet], grid[:, -quiet:]):
            self.assertFalse(edge.any())
        for top, left in ((quiet, quiet), (quiet, side - quiet - 7), (side - quiet - 7, quiet)):
            self.assertTrue((grid[top:top + 7, left:left + 7] == FINDER).all())

    def test_png_scans_back_to_the_route_address(self):
        for link in (ROUTE, ROMANIAN, "http://localhost/"):
            picture = cv2.imdecode(numpy.frombuffer(share.png(link), numpy.uint8), cv2.IMREAD_GRAYSCALE)
            self.assertEqual(picture.shape[0], len(share.modules(link)) * share.SCALE)
            self.assertEqual(scan(picture), link)

    def test_svg_paints_the_same_code(self):
        for link in (ROUTE, ROMANIAN):
            grid = drawn(share.svg(link))
            self.assertTrue((grid == share.modules(link)).all())
            picture = numpy.where(grid, 0, 255).astype(numpy.uint8)
            self.assertEqual(scan(cv2.resize(picture, None, fx=8, fy=8, interpolation=cv2.INTER_NEAREST)), link)

    def test_only_route_addresses_of_this_app_are_accepted(self):
        for link in (ROUTE, ROMANIAN, "http://localhost", "https://LOCALHOST/?to=D1", "http://localhost/?from=355"):
            self.assertEqual(share.route_link(link, "localhost"), link)
        self.assertEqual(share.route_link("http://127.0.0.1:8765/?to=D1", "127.0.0.1:8765"), "http://127.0.0.1:8765/?to=D1")
        refused = (
            "http://localhost/campus/?to=D1",
            "http://localhost/campus/api?to=D1",
            "http://localhost/campusx?to=D1",
            "http://localhost//campus?to=D1",
            None,
            "",
            "localhost/?to=D1",
            "javascript:alert(1)",
            "ftp://localhost/?to=D1",
            "https://example.org/?to=D1",
            "http://localhost:8765/?to=D1",
            "http://user@localhost/?to=D1",
            "http://localhost/api/routes?to=D1",
            "http://localhost/?to=D1#steps",
            "http://localhost/?to=D1&next=https%3A%2F%2Fexample.org",
            "http://localhost/?to=sala de curs",
            "http://localhost/?to=Fabricație",
            "http://localhost/?to=" + "B" * share.LONGEST,
        )
        for link in refused:
            with self.subTest(link=link), self.assertRaises(ValueError):
                share.route_link(link, "localhost")

    def test_campus_page_of_an_app_behind_a_proxy_is_accepted(self):
        # An app that embeds the planner serves routes at /campus on its own public host.
        for link in (CAMPUS, "https://orar.example.org/campus", "https://orar.example.org/campus?from=355"):
            self.assertEqual(share.route_link(link, "orar.example.org"), link)
        self.assertEqual(share.route_link("http://localhost:3100/campus?to=A315", "localhost:3100"),
                         "http://localhost:3100/campus?to=A315")
        refused = (
            # The host is the public one passed on by the proxy, not any host.
            ("https://orar.example.org/campus?to=D1", "localhost"),
            ("https://evil.example.org/campus?to=D1", "orar.example.org"),
            # The other rules still hold on /campus.
            ("https://orar.example.org/campus?to=D1#steps", "orar.example.org"),
            ("https://orar.example.org/campus?to=D1&next=%2Fadmin", "orar.example.org"),
            ("https://orar.example.org/campus/qr?to=D1", "orar.example.org"),
            ("https://orar.example.org/api/campus?to=D1", "orar.example.org"),
        )
        for link, host in refused:
            with self.subTest(link=link, host=host), self.assertRaises(ValueError):
                share.route_link(link, host)

    def test_api_checks_the_address_against_the_host_the_proxy_passes_on(self):
        response = self.client.get("/api/qr", query_string={"link": CAMPUS, "format": "png"},
                                   headers={"Host": "orar.example.org"})
        self.assertEqual(response.status_code, 200)
        picture = cv2.imdecode(numpy.frombuffer(response.data, numpy.uint8), cv2.IMREAD_GRAYSCALE)
        self.assertEqual(scan(picture), CAMPUS)
        # The same address is not this app's own when the request came to another host.
        response = self.client.get("/api/qr", query_string={"link": CAMPUS})
        self.assertEqual(response.status_code, 400)
        response = self.client.get("/api/qr", query_string={"link": ROUTE}, headers={"Host": "orar.example.org"})
        self.assertEqual(response.status_code, 400)

    def test_api_returns_the_code_as_svg_or_png(self):
        response = self.client.get("/api/qr", query_string={"link": ROUTE})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.mimetype, "image/svg+xml")
        self.assertEqual(response.cache_control.max_age, 86400)
        self.assertTrue((drawn(response.get_data(as_text=True)) == share.modules(ROUTE)).all())

        response = self.client.get("/api/qr", query_string={"link": ROMANIAN, "format": "png"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.mimetype, "image/png")
        picture = cv2.imdecode(numpy.frombuffer(response.data, numpy.uint8), cv2.IMREAD_GRAYSCALE)
        self.assertEqual(scan(picture), ROMANIAN)

    def test_api_refuses_other_addresses_and_formats(self):
        for query in ({}, {"link": "https://example.org/?to=D1"}, {"link": ROUTE, "format": "gif"}):
            response = self.client.get("/api/qr", query_string=query)
            self.assertEqual(response.status_code, 400, query)
            self.assertTrue(response.get_json()["message"])


if __name__ == "__main__":
    unittest.main()
