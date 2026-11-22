import json
import tempfile
import unittest
from pathlib import Path

from app import create_app
from campuspath.classrooms import CATALOGUE, Classrooms
from campuspath.import_classrooms import import_register
from campuspath.jobs import EXAMPLES, video_key
from campuspath.routing import RouteQuestion, Tour
from campuspath.text import WAYS


class ClassroomTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tour = Tour()
        cls.client = create_app(cls.tour).test_client()

    def test_directory_can_page_through_every_room(self):
        all_ids = set()
        offset = 0
        while True:
            page = self.client.get("/api/classrooms", query_string={"offset": offset, "limit": 100}).get_json()
            if not page["items"]:
                break
            for item in page["items"]:
                self.assertNotIn(item["index"], all_ids)
                self.assertTrue(item["sources"])
                all_ids.add(item["index"])
            offset += len(page["items"])
        self.assertEqual(len(all_ids), page["total"])
        self.assertEqual(all_ids, set(self.tour.classrooms.records))

    def test_same_code_can_name_different_buildings(self):
        with self.assertRaises(RouteQuestion) as ambiguous:
            self.tour.plan("Take me to sala A109", 355)
        options = ambiguous.exception.options
        self.assertIn("room:electro-a109", {r["index"] for r in options})
        self.assertIn("room:aspc-a109", {r["index"] for r in options})
        self.assertEqual(self.tour.plan("A109 Construcții", 355)["steps"][-1]["index"], 460)
        self.assertEqual(self.tour.plan("A109", 355, "room:electro-a109")["coverage"], "checkpoint")

    def test_room_suffixes_and_numeric_separators(self):
        search = self.tour.classrooms.search
        self.assertEqual(search("sala B 418 b", strict=True)[0]["code"], "B418B")
        self.assertEqual(search("F1-1/1", strict=True)[0]["code"], "F1-1/1")
        self.assertFalse(search("B13", strict=True))
        self.assertEqual(search("B1-3", strict=True)[0]["code"], "B1-3")
        self.assertEqual(search("M2 Multimedia", strict=True)[0]["checkpoint"], 261)
        self.assertEqual(search("Amfiteatru 1", strict=True)[0]["checkpoint"], 348)

    def test_a_building_written_beside_the_room_settles_which_room(self):
        # Spellings taken from the 2026-27 timetables of AC, ETcTI, CHIM, RIA and MEC.
        search = self.tour.classrooms.search
        for request, room in (
            ("A1 MPT", "room:remus-a1"), ("M106 MPT", "room:remus-m106"), ("MPT - M102", "room:remus-m102"),
            ("A303 Ch", "room:chimie-a303"), ("A2CH", "room:chimie-a2"), ("A2 Chimie", "room:chimie-a2"),
            ("CEL 403", "room:cel-c403"), ("CEL401", "room:cel-c401"), ("C401 CEL", "room:cel-c401"),
            ("MEC-N301", "room:mecanica-n301"), ("MEC - M304", "room:mecanica-m304"),
            ("206 Orologerie", "room:orologerie-o206"), ("206 Orologerie Et.2", "room:orologerie-o206"),
            ("Orologerie 112", "room:orologerie-o112"), ("Orologerie 407", "room:orologerie-o407"),
            ("ASPC 306", "room:aspc-a306"), ("ASPC323", "room:aspc-a323"), ("ASPC 1", "room:aspc-aspc1"),
            ("ASPC 113", "room:aspc-113"), ("ASPC113", "room:aspc-113"),
        ):
            with self.subTest(request=request):
                self.assertEqual([r["index"] for r in search(request, strict=True)], [room])

    def test_a_named_building_is_not_swapped_for_another(self):
        search = self.tour.classrooms.search
        # A206 exists in ASPC and in Electro. A timetable that says SPM means neither of them.
        self.assertEqual(search("A206 SPM", strict=True), [])
        self.assertEqual(search("A109 ASPC", strict=True)[0]["index"], "room:aspc-a109")
        self.assertEqual({r["index"] for r in search("A206", strict=True)}, {"room:aspc-a206", "room:electro-a206"})
        with self.assertRaises(RouteQuestion) as unknown:
            self.tour.plan("A206 SPM", "auto")
        self.assertEqual(unknown.exception.key, "ask.unknown")

    def test_two_rooms_in_one_timetable_cell_are_offered_as_a_choice(self):
        search = self.tour.classrooms.search
        both = {"room:mecanica-m214", "room:mecanica-n214"}
        for request in ("M214/N214", "N 214/M214", "laborator N214 si M214"):
            with self.subTest(request=request):
                self.assertEqual({r["index"] for r in search(request, strict=True)}, both)
        self.assertEqual({r["index"] for r in search("C402-C403", strict=True)}, {"room:cel-c402", "room:cel-c403"})
        # Codes that contain a separator themselves are still one room.
        self.assertEqual(search("F1-1/1", strict=True)[0]["code"], "F1-1/1")
        self.assertEqual(search("B1-3", strict=True)[0]["code"], "B1-3")

    def test_classrooms_carry_the_names_a_timetable_gives_their_building(self):
        records = self.tour.classrooms.records
        self.assertIn("MPT", records["room:remus-a1"]["areaAliases"])
        self.assertEqual(records["room:electro-b419"]["areaAliases"], [])

    def test_nearby_rooms_have_different_video_captions_and_keys(self):
        routes = [self.tour.plan(q, 388) for q in ("B418A", "B418B")]
        for r in routes:
            self.assertEqual(r["coverage"], "checkpoint")
            self.assertEqual(r["steps"][-1]["index"], 389)
            self.assertIn("on this floor", r["steps"][-1]["instruction"])
        self.assertNotEqual(video_key(self.tour, routes[0]), video_key(self.tour, routes[1]))
        exact = self.tour.plan("From the AC entrance to B419")
        self.assertEqual(exact["coverage"], "exact")
        self.assertEqual(video_key(self.tour, exact),
                         json.loads(EXAMPLES["en"].with_suffix(".json").read_text(encoding="utf-8"))["key"])

    def test_room_codes_lead_to_their_wing_and_floor(self):
        for code, checkpoint, floor, phrase in (
            ("B413A", 389, 4, "on floor 4 of Corp B"), ("B413", 389, 4, "on floor 4 of Corp B"),
            ("B313", 387, 3, "on floor 3 of Corp B"), ("B624", 396, 6, "on floor 6 of Corp B"),
            ("A315", 386, 3, "on floor 3 of Corp A"), ("D104", 627, 1, "on floor 1 of Corp D"),
            ("D005", 630, 0, "on the ground floor of Corp D"),
            # Floors the tour never photographed end at the nearest stairs with the remaining climb.
            ("B520", 388, 4, "B520 is one floor up by the stairs in the last view, on floor 5"),
            ("B712", 395, 6, "one floor up by the stairs in the last view, on floor 7"),
            # The Corp B stairwell starts on the ground floor: the back entrance opens onto it from the street.
            ("B219A", 415, 0, "two floors up by the stairs in the last view, on floor 2"),
            ("B014", 415, 0, "on the ground floor of Corp B. B014 is on this floor"),
            # Corp C has no panorama. A door plate "C 015" places its ground floor at the rear exit.
            ("C003", 405, 0, "on the ground floor of Corp C. C003 is on this floor"),
            ("C104", 405, 0, "C104 is one floor up, on floor 1, which the tour does not show"),
            ("A204", 407, 0, "two floors up by the stairs in the last view, on floor 2"),
        ):
            with self.subTest(code=code):
                route = self.tour.plan(code, 355, "room:electro-" + code.lower())
                self.assertEqual(route["coverage"], "checkpoint")
                self.assertEqual((route["steps"][-1]["index"], route["steps"][-1]["floor"]), (checkpoint, floor))
                self.assertGreater(len(route["steps"]), 1)
                self.assertIn(phrase, route["notice"])
                self.assertIn(code, route["steps"][-1]["instruction"])
        # The numbering outranks a register that lists B624 with the third-floor labs.
        self.assertEqual(self.tour.classrooms.records["room:electro-b624"]["level"], "Etaj 6")

    def test_a_route_that_stops_at_stairs_ends_facing_them(self):
        last = self.tour.plan("B520", 355, "room:electro-b520")["steps"][-1]
        self.assertEqual((last["yaw"], last["pitch"]), (152.5, 2))
        self.assertIn("yaw=152.5", last["url"])
        self.assertEqual(last["instruction"], "Tour ends here. B520 is one floor up by these stairs, on floor 5.")
        # Standing on the landing already, there is no last view to point at.
        here = self.tour.plan("B520", 388, "room:electro-b520")
        self.assertIn("B520 is one floor up, on floor 5, which the tour does not show", here["notice"])
        # The floor below has no stairs in the tour, so its route keeps the panorama's opening view.
        self.assertEqual(self.tour.plan("B014", 355, "room:electro-b014")["steps"][-1]["yaw"], 0)

    def test_each_room_says_how_near_the_tour_gets(self):
        reach = lambda rid: self.tour.classrooms.records["room:" + rid]["reach"]
        self.assertEqual([reach(r) for r in ("electro-b419", "electro-b413a", "electro-b520", "hunedoara-d1-14",
                                             "electro-d012")],
                         ["room", "floor", "near", "entrance", "door"])
        self.assertEqual(self.client.post("/api/routes", json={"prompt": "T-113"}).get_json()["destination"]["reach"], "none")
        for room in self.tour.classrooms.records.values():
            self.assertEqual(room["reach"] in ("room", "none"), room["coverage"] != "checkpoint", room["index"])
        entrance = self.tour.plan("302", 355, "room:chimie-302")
        self.assertIn("The tour does not show where 302 is in the building.", entrance["notice"])

    def test_named_tour_rooms_answer_to_their_door_numbers(self):
        for query, checkpoint in (("D1", 862), ("sala D001", 862), ("amfiteatrul Rogojan", 862),
                                  ("AMF Alexandru Rogojan", 862), ("A307", 380), ("B114", 467),
                                  ("D106", 623), ("D003", 632)):
            with self.subTest(query=query):
                route = self.tour.plan(query, 355)
                self.assertEqual((route["coverage"], route["steps"][-1]["index"]), ("exact", checkpoint))
        self.assertEqual(self.tour.plan("D1", 355)["destination"]["name"], "D1 · AMF Alexandru Rogojan")
        self.assertEqual(self.tour.plan("D001A", 355)["destination"]["index"], "room:electro-d001a")

    def test_spm_timetable_numbers_with_the_building_last(self):
        for query in ("106 SPM", "sala 106 spm"):
            self.assertEqual(self.tour.plan(query, "auto")["destination"]["code"], "SPM106")
        with self.assertRaises(RouteQuestion) as choice:
            self.tour.plan("106 /115 SPM", "auto")
        self.assertEqual({room["code"] for room in choice.exception.options}, {"SPM106", "SPM115"})

    def test_floors_borrow_the_checkpoint_outside_a_photographed_room(self):
        outside = [(3, 741, ("", 4), "Proiectare 3D Et.4")]
        anchor = lambda zone, found=outside: Classrooms.anchor(zone, {}, found, self.tour)
        self.assertEqual(anchor(("", 4)), {"floor": 4, "wing": "", "at": 4, "checkpoint": 741, "beside": "Proiectare 3D Et.4"})
        # The next floor will do, but not another wing, and the ground floor never borrows upstairs.
        self.assertEqual((anchor(("", 3))["at"], anchor(("", 5))["at"]), (4, 4))
        self.assertIsNone(anchor(("B", 4)).get("checkpoint"))
        self.assertIsNone(anchor(("", 0), [(1, 9, ("", 1), "x")]).get("checkpoint"))
        route = self.tour.plan("C402", 314, "room:cel-c402")
        self.assertIn("outside Sala C401", route["notice"])
        # A room on a wing or in a building the tour never enters stays at the entrance.
        for query, start, choice in (("D1-14", 634, "room:hunedoara-d1-14"), ("103", 360, "room:mecanica-103")):
            self.assertEqual([s["index"] for s in self.tour.plan(query, start, choice)["steps"]], [start])

    def test_site_anchors_name_indexed_checkpoints(self):
        sites = json.loads(CATALOGUE.read_text(encoding="utf-8"))["sites"]
        anchored = 0
        for key, site in sites.items():
            for zone, anchor in site.get("anchors", {}).items():
                with self.subTest(site=key, zone=zone):
                    anchored += 1
                    self.assertIn(anchor["checkpoint"], self.tour.by_id)
                    self.assertTrue(site.get("zones") or site.get("floors"))
                    # A wing letter comes first only where the building's codes name a wing.
                    floor = zone[1:] if "?P<wing>" in site.get("zones", "") else zone
                    self.assertRegex(floor, r"^(-?\d|M)$")
                    self.assertEqual(len(anchor.get("look", [0, 0])), 2)
        self.assertGreater(anchored, 50)

    def test_surveyed_doors_and_corridors_point_at_indexed_checkpoints(self):
        rooms = json.loads(CATALOGUE.read_text(encoding="utf-8"))["rooms"]
        doors = [r for r in rooms if "door" in r]
        self.assertGreaterEqual(len(doors), 9)
        for row in doors + [r for r in rooms if "near" in r]:
            with self.subTest(room=row["id"]):
                self.assertNotIn("scene", row)
                self.assertIn(row["door"]["scene"] if "door" in row else row["near"], self.tour.by_id)
                record = self.tour.classrooms.records["room:" + row["id"]]
                self.assertEqual(record["reach"], "door" if "door" in row else "floor")
        route = self.tour.plan("O410", 731, "room:orologerie-o410")
        last = route["steps"][-1]
        self.assertEqual((last["index"], last["yaw"], last["floor"]), (741, -15.5, 4))
        self.assertEqual(last["instruction"], "Tour ends here. The door ahead is O410.")
        self.assertIn("The last view faces the door of O410.", route["notice"])
        # A plate can overrule the registers: the lab the tour photographed is A323, once listed as A317.
        self.assertEqual([r["code"] for r in self.tour.classrooms.search("A317", strict=True)], ["A323"])
        self.assertEqual(self.tour.classrooms.records["room:aspc-a323"]["reach"], "room")

    def test_directions_use_what_the_survey_saw_ahead(self):
        said = [step["instruction"] for step in self.tour.plan("O206", 731, "room:orologerie-o206")["steps"]]
        self.assertEqual(said[2:5], ["Turn right and take the stairs up to the mezzanine.",
                                     "Turn right and take the stairs up to floor 1.",
                                     "Turn right and take the stairs up to floor 2."])
        lift = [step["instruction"] for step in self.tour.plan("V2", 473, "room:chimie-v2", "ro")["steps"]]
        self.assertIn("Fă stânga și ia liftul până la etajul 1.", lift)
        for note in self.tour.annotations.values():
            for target, way in note.get("ways", {}).items():
                self.assertIn(target, self.tour.by_id)
                self.assertIn(way, WAYS)

    def test_one_checkpoint_is_described_instead_of_filmed(self):
        for prompt, start, words in (("D1-14", 634, "no walkthrough to show. D1-14 is on floor 1 of Corp D"),
                                     ("B413A", 389, "already at the display hall, on floor 4 of Corp B"),
                                     ("B419", 392, "already at Lab. B419")):
            with self.subTest(prompt=prompt):
                body = self.client.post("/api/routes", json={"prompt": prompt, "start": start}).get_json()
                self.assertEqual((len(body["steps"]), body["duration"]), (1, 0))
                self.assertIsNone(body["video"])
                self.assertIn(words, body["notice"])
        # Whatever the room, a rendered walkthrough always moves between at least two checkpoints.
        entrances = {s["name"]: self.tour.by_id.get(s.get("checkpoint")) for s in
                     json.loads(CATALOGUE.read_text(encoding="utf-8"))["sites"].values()}
        for room in self.tour.classrooms.records.values():
            if room["coverage"] != "unmapped" and entrances[room["area"]]:
                route = self.tour.plan(room["code"] or room["label"], entrances[room["area"]], room["index"])
                self.assertEqual(route["duration"], 0 if len(route["steps"]) == 1 else 3 * len(route["steps"]))
                self.assertTrue(len(route["steps"]) > 1 or "notice" in route, room["index"])

    def test_api_takes_the_start_from_a_link(self):
        body = self.client.post("/api/routes", json={"prompt": "B419", "from": "#392"}).get_json()
        self.assertEqual([step["index"] for step in body["steps"]], [392])
        reply = self.client.post("/api/routes", json={"prompt": "B419", "from": ["AC"]})
        self.assertEqual(reply.status_code, 422)

    def test_unmapped_destination_shows_sources_and_skips_video(self):
        body = self.client.post("/api/routes", json={"prompt": "T-113"}).get_json()
        self.assertEqual(body["coverage"], "unmapped")
        self.assertEqual(body["steps"], [])
        self.assertIsNone(body["video"])
        self.assertTrue(body["destination"]["sources"])
        self.assertIn("Carol Telbisz", body["destination"]["area"])

    def test_catalogue_origins_and_explicit_choice_for_an_unmapped_start(self):
        r = self.tour.plan("From B418B to B419")
        self.assertEqual(r["steps"][0]["index"], 389)
        self.assertIn("starting room", r["notice"])
        with self.assertRaises(RouteQuestion) as missing:
            self.tour.plan("From T113 to B419")
        self.assertEqual(missing.exception.field, "start")
        self.assertTrue(missing.exception.choose)
        self.assertEqual(self.tour.plan("From T113 to B419", 355)["steps"][0]["index"], 355)

    def test_lookup_for_every_directory_selection(self):
        for r in self.tour.classrooms.records.values():
            self.assertEqual(self.tour.resolve(r["code"] or r["label"], "destination", r["index"]), r["index"])

    def test_register_is_atomic_and_idempotent(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "classrooms.json"
            path.write_bytes(CATALOGUE.read_bytes())
            register = Path(folder) / "register.csv"
            register.write_text("site,code,name,checkpoint\nelectro,B 418 b,Teaching lab,389\n")
            count = import_register(register, "Registrar export", catalogue=path, as_of="2026-11-20")
            self.assertEqual(count, len(self.tour.classrooms.records))
            before = path.read_bytes()
            self.assertEqual(import_register(register, "Registrar export", catalogue=path, as_of="2026-11-20"), count)
            self.assertEqual(path.read_bytes(), before)
            register.write_text("site,code,name,panorama\nelectro,NEW1,First lab,\nelectro,NEW2,Second lab,#99999\n")
            with self.assertRaisesRegex(ValueError, "Unknown ground-tour panorama"):
                import_register(register, "Registrar export", catalogue=path)
            self.assertEqual(path.read_bytes(), before)


if __name__ == "__main__":
    unittest.main()
