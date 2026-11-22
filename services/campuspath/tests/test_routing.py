import unittest

from campuspath.routing import (EXAMPLE_END, EXAMPLE_START, HOP_METRES, RouteQuestion, Tour, direction,
                                marker_distance)


class RoutingTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tour = Tour()
        cls.entrance = cls.tour.by_id[EXAMPLE_START]
        cls.lab = cls.tour.by_id[EXAMPLE_END]

    def test_b419_requests_use_the_published_room(self):
        for prompt in ("I want to go to sala B419", "Am un curs în sala B-419, cum ajung?",
                       "Can you help me find B 419?"):
            with self.subTest(prompt=prompt):
                route = self.tour.plan(prompt, self.entrance)
                self.assertEqual(route["steps"][-1]["index"], self.lab)
                self.assertEqual(route["steps"][-1]["floor"], 4)

    def test_each_step_is_a_directed_tour_hotspot(self):
        steps = self.tour.example()["steps"]
        for current, following in zip(steps, steps[1:]):
            edge = next(e for e in self.tour.scenes[current["index"]]["links"] if e["to"] == following["index"])
            self.assertEqual((current["yaw"], current["pitch"]), (edge["yaw"], edge["pitch"]))
            self.assertIn("#media=" + str(current["index"]) + "&", current["url"])
        self.assertEqual(steps[0]["index"], self.entrance)

    def test_origin_in_either_order_and_in_shared_tour_link(self):
        for prompt in ("From the AC entrance to B419", "La B419 de la intrarea AC",
                       f"From https://visit360.upt.ro/#media={self.entrance} to B419",
                       "AC entrance to sala B419"):
            with self.subTest(prompt=prompt):
                route = self.tour.plan(prompt)
                self.assertEqual((route["steps"][0]["index"], route["steps"][-1]["index"]),
                                 (self.entrance, self.lab))

    def test_a_link_can_name_the_start_apart_from_the_request(self):
        for origin in ("AC entrance", "intrarea AC", f"#{self.entrance}", str(self.entrance)):
            with self.subTest(origin=origin):
                route = self.tour.plan("B419", origin=origin)
                self.assertEqual((route["steps"][0]["index"], route["steps"][-1]["index"]), (self.entrance, self.lab))
        # It outranks a start written into the request, and is held to the same limits.
        self.assertEqual(self.tour.plan("From Hol Principal to B419", origin="#392")["steps"][0]["index"], self.lab)
        for origin in ("x" * 201, 355, ["AC entrance"]):
            with self.assertRaises(RouteQuestion):
                self.tour.plan("B419", origin=origin)

    def test_missing_start_and_ambiguous_lobby_require_a_choice(self):
        with self.assertRaises(RouteQuestion) as absent:
            self.tour.plan("Go to B419")
        self.assertEqual(absent.exception.field, "start")
        with self.assertRaises(RouteQuestion) as ambiguous:
            self.tour.plan("From Hol Principal to B419")
        choices = ambiguous.exception.options
        self.assertGreater(len({r["area"] for r in choices}), 1)
        ac = next(r["index"] for r in choices if r["area"] == "Automatică și Calculatoare")
        self.assertEqual(self.tour.plan("From Hol Principal to B419", ac)["steps"][0]["index"], ac)

    def test_automatic_start_is_the_nearest_mapped_entrance(self):
        route = self.tour.plan("I want to go to sala B419", "auto")
        self.assertEqual((route["steps"][0]["index"], route["steps"][-1]["index"]), (355, self.lab))
        self.assertTrue(route["automatic"])
        self.assertEqual(route["origin"]["index"], 355)
        self.assertEqual(set(route["origin"]["pin"]), {"lat", "lon", "name"})
        # The origin is named in the requested language, like the steps.
        self.assertEqual(self.tour.plan("B419", "auto", lang="ro")["origin"]["name"], "Intrarea AC")
        # A room in another building starts at that building's entrance.
        aspc = self.tour.plan("", "auto", "room:aspc-a109")
        self.assertEqual(aspc["origin"]["index"], 357)
        self.assertEqual(aspc["destination"]["index"], "room:aspc-a109")
        # One backward search agrees with walking forward from every pin.
        pins = [index for index, record in self.tour.records.items() if "pin" in record]
        for target in (self.lab, 34, 455):
            chosen = self.tour.nearest_entrance(target)
            walk = lambda start: len(self.tour.route(start, target)["steps"])
            reachable = [p for p in pins if target in self.tour.reach(p)]
            self.assertIn(chosen, reachable)
            self.assertLessEqual(walk(chosen), min(walk(p) for p in reachable) + 1)

    def test_automatic_start_keeps_named_starts_and_explains_gaps(self):
        # A start written into the request or passed as origin still wins.
        self.assertEqual(self.tour.plan("From Hol Principal to B419", "auto", origin="#392")["steps"][0]["index"], self.lab)
        self.assertNotIn("automatic", self.tour.plan("From the AC entrance to B419", "auto"))
        self.assertEqual(self.tour.plan("B419", self.entrance)["steps"][0]["index"], self.entrance)
        # No pinned checkpoint reaches this one: the usual explanation.
        pins = [index for index, record in self.tour.records.items() if "pin" in record]
        reached = set().union(*(self.tour.reach(p) for p in pins))
        stranded = next(index for index in self.tour.scenes if index not in reached)
        self.assertIsNone(self.tour.nearest_entrance(stranded))
        with self.assertRaisesRegex(RouteQuestion, "no connected ground route"):
            self.tour.plan(f"#{stranded}", "auto")
        # A room the tour does not reach needs no start at all.
        unmapped = next(r for r in self.tour.classrooms.records.values() if r["coverage"] == "unmapped")
        self.assertEqual(self.tour.plan("", "auto", unmapped["index"])["coverage"], "unmapped")

    def test_similar_room_code_and_aerial_start_never_substitute(self):
        for unknown in ("B4199", "B419A", "B9999"):
            with self.subTest(unknown=unknown), self.assertRaises(RouteQuestion):
                self.tour.plan(f"Go to sala {unknown}", self.entrance)
        with self.assertRaises(RouteQuestion):
            self.tour.plan("From https://visit360.upt.ro/#media=1 to B419")

    def test_a_room_number_is_never_read_as_a_checkpoint_number(self):
        # Timetables name rooms "106" or "225 A". The tour happens to number its panoramas too,
        # and an unnamed panorama must not stand in for a room that is not in the catalogue.
        for room in ("106", "115", "206", "22", "225 A", "303", "sala 118"):
            with self.subTest(room=room), self.assertRaises(RouteQuestion) as unknown:
                self.tour.plan(room, "auto")
            self.assertEqual(unknown.exception.key, "ask.unknown")
        # A checkpoint is still reachable by its number when the request says it is one.
        for reference in ("#106", "checkpoint 106", "punctul 106"):
            with self.subTest(reference=reference):
                self.assertEqual(self.tour.plan(reference, self.entrance)["steps"][-1]["index"], 106)
        # Searching for a starting point by number keeps working as you type.
        self.assertIn(106, [r["index"] for r in self.tour.search("106")])

    def test_a_place_in_hunedoara_is_never_chosen_silently_over_one_in_timisoara(self):
        # "Bibliotecă" is the exact name of the Hunedoara library; Timișoara's is "Biblioteca UPT".
        for request in ("biblioteca", "library"):
            with self.subTest(request=request), self.assertRaises(RouteQuestion) as which:
                self.tour.plan(request, "auto", lang="ro")
            areas = {option["area"] for option in which.exception.options}
            self.assertIn("Inginerie Hunedoara", areas)
            self.assertGreater(len(areas), 1)
            # The student's own campus comes first: Timișoara, unless they study in Hunedoara.
            self.assertNotIn("Hunedoara", which.exception.options[0]["area"])
            with self.assertRaises(RouteQuestion) as theirs:
                self.tour.plan(request, "auto", lang="ro", home="hunedoara")
            self.assertEqual(theirs.exception.options[0]["area"], "Inginerie Hunedoara")
        # Named in full, each is found without a question.
        self.assertEqual(self.tour.plan("Biblioteca UPT", "auto")["steps"][-1]["index"], 110)
        # A route that does end in Hunedoara says so first, in the language asked for.
        hunedoara = self.tour.plan("aula magna", "auto", lang="ro")
        self.assertTrue(hunedoara["warning"].startswith("Locul acesta este în campusul din Hunedoara"))
        self.assertIn("Hunedoara campus", self.tour.plan("aula magna", "auto")["warning"])
        self.assertNotIn("warning", self.tour.plan("B419", "auto"))
        # A student of the Hunedoara faculty is not told where their own campus is.
        self.assertNotIn("warning", self.tour.plan("aula magna", "auto", home="hunedoara"))

    def test_disconnected_component_and_same_location(self):
        isolated = next(i for i, s in self.tour.scenes.items() if not s["links"])
        with self.assertRaisesRegex(RouteQuestion, "no connected ground route"):
            self.tour.route(isolated, self.lab)
        steps = self.tour.route(self.lab, self.lab)["steps"]
        self.assertEqual(len(steps), 1)
        self.assertEqual(steps[0]["kind"], "arrival")

    def test_source_arrow_is_not_implicitly_reversible(self):
        # Pick a one-way link from the published index. Its return journey
        # must use a different chain of hotspots or report a gap.
        for source, scene in self.tour.scenes.items():
            for edge in scene["links"]:
                target = edge["to"]
                if source != target and all(back["to"] != source for back in self.tour.scenes[target]["links"]):
                    try:
                        reverse = self.tour.route(target, source)
                    except RouteQuestion:
                        return
                    self.assertGreater(len(reverse["steps"]), 2)
                    return
        self.fail("Expected the tour to contain a one-way hotspot")

    def test_walk_through_the_building_beats_fewer_checkpoints_around_it(self):
        # Outdoor panoramas stand several times farther apart than indoor ones. The way to Corp D
        # through the main hall has one checkpoint more than the walk around the building.
        steps = self.tour.plan("From the AC entrance to D1")["steps"]
        outdoors = [s["name"] for s in steps if s["index"] in self.tour.outdoors]
        self.assertEqual(outdoors, ["AC entrance", "Corp D entrance"])
        # The library and the conference centre stand outdoors although their previews show interiors.
        self.assertTrue({110, 111} <= self.tour.outdoors)
        self.assertEqual(steps[1]["label"], "Hol Principal")
        self.assertEqual(steps[-1]["label"], "AMF Alexandru Rogojan")

    def test_no_other_route_is_a_shorter_estimated_walk(self):
        def metres(route):
            indices = [s["index"] for s in route["steps"]]
            return sum(HOP_METRES[(a in self.tour.outdoors) + (b in self.tour.outdoors)]
                       for a, b in zip(indices, indices[1:]))

        # Bellman-Ford over every link reaches the same length as each planned route.
        best = {self.entrance: 0}
        for _ in self.tour.scenes:
            changed = False
            for source in list(best):
                for edge in self.tour.scenes[source]["links"]:
                    hop = HOP_METRES[(source in self.tour.outdoors) + (edge["to"] in self.tour.outdoors)]
                    if best[source] + hop < best.get(edge["to"], float("inf")):
                        best[edge["to"]] = best[source] + hop
                        changed = True
            if not changed:
                break
        self.assertGreater(len(best), 100)
        for end in list(best)[::7]:
            self.assertEqual(metres(self.tour.route(self.entrance, end)), best[end])

    def test_checked_notes_override_the_importers_open_air_flag(self):
        flags = {s["id"]: s["open"] for s in self.tour.scenes.values()}
        self.assertTrue(all(type(flag) is bool for flag in flags.values()))
        for scene, note in self.tour.annotations.items():
            if "open" in note:
                self.assertNotEqual(flags[scene], note["open"], "the note repeats the importer")
                self.assertEqual(self.tour.by_id[scene] in self.tour.outdoors, note["open"])
        self.assertIn(self.entrance, self.tour.outdoors)
        self.assertNotIn(self.lab, self.tour.outdoors)

    def test_marker_distance_ignores_markers_near_the_horizon(self):
        self.assertAlmostEqual(marker_distance(-45), 1.7)
        self.assertEqual(marker_distance(-1), HOP_METRES[0])
        self.assertEqual(marker_distance(12), HOP_METRES[0])

    def test_turn_heading_wraps_across_the_panorama_seam(self):
        edge = {"kind": "walk", "yaw": -175}
        self.assertEqual(direction(175, edge, "B419"), "Continue ahead toward B419.")
        self.assertEqual(direction(175, edge, None), "Continue ahead.")
        self.assertEqual(direction(0, edge, "the stairs"), "Turn around toward the stairs.")


if __name__ == "__main__":
    unittest.main()
