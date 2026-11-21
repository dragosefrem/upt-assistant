import json
import unittest
from unittest import mock

import cv2
import numpy as np

from campuspath import import_tour
from campuspath.source import SNAPSHOT


def preview(upper, lower=(90, 90, 90)):
    """An equirectangular preview with one colour above the horizon and one below (BGR)."""
    image = np.empty((362, 724, 3), np.uint8)
    image[:181], image[181:] = upper, lower
    return cv2.imencode(".jpg", image)[1].tobytes()


class OpenAirTests(unittest.TestCase):
    def test_sky_and_foliage_overhead_mean_outdoors(self):
        self.assertTrue(import_tour.open_air(preview((230, 150, 60))))    # blue sky
        self.assertTrue(import_tour.open_air(preview((40, 140, 60))))     # tree canopy
        self.assertTrue(import_tour.open_air(preview((250, 250, 250))))   # overcast
        self.assertFalse(import_tour.open_air(preview((205, 210, 215))))  # painted ceiling
        self.assertFalse(import_tour.open_air(preview((60, 120, 200))))   # timber ceiling

    def test_a_window_does_not_make_a_room_outdoors(self):
        image = np.full((362, 724, 3), (205, 210, 215), np.uint8)
        image[60:150, 100:220] = (230, 150, 60)
        self.assertFalse(import_tour.open_air(cv2.imencode(".jpg", image)[1].tobytes()))

    def test_unreadable_preview_is_reported(self):
        with self.assertRaises(ValueError):
            import_tour.open_air(b"not an image")

    def test_known_panoramas_keep_their_flag_without_a_download(self):
        snapshot = json.loads(SNAPSHOT.read_bytes())["scenes"]
        known = [{"id": s["id"], "thumb": s["thumb"]} for s in snapshot[:40]]
        added = {"id": "panorama_new", "thumb": "media/panorama_new_t.jpg"}
        with mock.patch.object(import_tour, "fetch", return_value=preview((230, 150, 60))) as fetch:
            import_tour.mark_open_air([*known, added], "7")
        self.assertEqual([s["open"] for s in known], [s["open"] for s in snapshot[:40]])
        self.assertIs(added["open"], True)
        fetch.assert_called_once_with("https://visit360.upt.ro/media/panorama_new_t.jpg?v=7")


if __name__ == "__main__":
    unittest.main()
