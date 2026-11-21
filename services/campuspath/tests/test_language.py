import json
import re
import string
import unittest

from app import create_app
from campuspath import video
from campuspath.jobs import EXAMPLES, video_key
from campuspath.routing import RouteQuestion, Tour, direction, partial_arrival
from campuspath.source import ROOT
from campuspath.text import LANGUAGES, LEADS, TEXT, WAYS, floor_phrase, floors_away, language, move, say

ENGLISH = re.compile(r"\b(toward|checkpoint|floor|walk|tour ends|destination|outside)\b", re.I)


def text_of(route):
    words = [route.get("notice", "")]
    for step in route["steps"]:
        words += [step["name"], step["instruction"], step.get("caption", "")]
    return " ".join(words)


class LanguageTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tour = Tour()
        cls.client = create_app(cls.tour).test_client()

    def test_every_sentence_exists_in_each_language_with_the_same_blanks(self):
        blanks = lambda text: sorted(name for _, name, _, _ in string.Formatter().parse(text) if name)
        for key, forms in TEXT.items():
            with self.subTest(key=key):
                self.assertEqual(len(forms), len(LANGUAGES))
                self.assertTrue(all(forms))
                self.assertEqual(blanks(forms[0]), blanks(forms[1]))
        self.assertEqual([language(v) for v in ("ro", "en", "de", None, ["ro"])], ["ro", "en", "en", "en", "en"])

    def test_floors_read_naturally_in_both_languages(self):
        self.assertEqual(floor_phrase("en", 4, "B"), "on floor 4 of Corp B")
        self.assertEqual(floor_phrase("ro", 4, "B"), "la etajul 4, în Corpul B")
        self.assertEqual((floor_phrase("en", 0), floor_phrase("ro", 0)), ("on the ground floor", "la parter"))
        self.assertEqual((floor_phrase("en", -1), floor_phrase("ro", "A")), ("in the basement", "la mansardă"))
        self.assertEqual((floors_away("en", 2), floors_away("ro", 2)), ("two floors up", "cu două etaje mai sus"))
        self.assertEqual((floors_away("en", -1), floors_away("ro", -3)), ("one floor down", "cu 3 etaje mai jos"))

    def test_a_checked_way_ahead_is_part_of_the_direction(self):
        for table in (LEADS, WAYS):
            self.assertTrue(all(len(forms) == len(LANGUAGES) and all(forms) for forms in table.values()))
        self.assertEqual(move("en", "step.turn.left", "stairs_up", floor=2), "Turn left and take the stairs up to floor 2.")
        self.assertEqual(move("ro", "step.turn.left", "stairs_up", floor=2), "Fă stânga și urcă pe scări până la etajul 2.")
        self.assertEqual(move("en", "step.back", "stairs_down", floor=0), "Turn around and take the stairs down to the ground floor.")
        self.assertEqual(move("ro", "step.back", "stairs_down", floor=0), "Întoarce-te și coboară pe scări până la parter.")
        self.assertEqual(move("en", "step.ahead", "corridor"), "Follow the corridor.")
        self.assertEqual(move("ro", "step.follow", "hall", "holul InfoCenter"), "Traversează holul spre holul InfoCenter.")
        # A floor is only worth saying on stairs; elsewhere the next checkpoint's name is.
        self.assertEqual(move("en", "step.bear.right", "doorway", "the lifts", 4), "Bear right and go through the doorway toward the lifts.")
        edge = {"kind": "walk", "yaw": 90}
        self.assertEqual(direction(0, edge, None, "en", "stairs_up", 3), "Turn right and take the stairs up to floor 3.")
        self.assertEqual(direction(0, edge, None, "en", "outside"), "Turn right.")

    def test_a_route_can_end_facing_the_door_read_from_its_plate(self):
        room = {"reach": "door", "anchor": {"door": True, "look": [34.5, 4], "at": 4, "floor": 4, "wing": "B"}}
        notice, caption, floor = partial_arrival(room, "the display hall", "B413", "B413")
        self.assertEqual(notice, "The video ends at the display hall, on floor 4 of Corp B. The last view faces the door of B413.")
        self.assertEqual((caption, floor), ("Tour ends here. The door ahead is B413.", 4))
        notice, caption, _ = partial_arrival(room, "holul cu vitrine", "B413", "B413", True, "ro")
        self.assertIn("Imaginea de mai jos îi arată ușa.", notice)
        self.assertEqual(caption, "Turul se termină aici. Ușa din față este B413.")

    def test_a_romanian_route_names_and_directs_in_romanian(self):
        route = self.tour.plan("De la intrarea AC la D1", lang="ro")
        english = self.tour.plan("From the AC entrance to D1")
        self.assertEqual((route["lang"], english["lang"]), ("ro", "en"))
        self.assertEqual([s["index"] for s in route["steps"]], [s["index"] for s in english["steps"]])
        self.assertEqual([s["name"] for s in route["steps"]][:2], ["Intrarea AC", "Holul principal"])
        self.assertEqual(route["steps"][2]["instruction"], "Fă stânga și mergi pe coridor spre scara din holul principal.")
        self.assertEqual(route["steps"][-1]["instruction"], "Ai ajuns la destinație.")
        self.assertEqual(english["steps"][2]["instruction"], "Turn left and follow the corridor toward the main hall staircase.")
        # The heading keeps its capital. Only the sentence uses the running form.
        self.assertEqual((route["steps"][3]["name"], english["steps"][3]["name"]),
                         ("Scara din holul principal", "Main hall staircase"))
        self.assertIsNone(ENGLISH.search(text_of(route)), text_of(route))
        self.assertNotEqual(video_key(self.tour, route), video_key(self.tour, english))

    def test_every_route_sentence_has_a_romanian_form(self):
        for prompt, start in (("B413A", 355), ("B520", 355), ("B014", 355), ("C104", 355), ("D1-14", 634), ("B413A", 389),
                              ("O405", 731), ("B2-11", 634), ("B419", 392), ("T-113", None), ("De la B418B la B419", None)):
            with self.subTest(prompt=prompt):
                route = self.tour.plan(prompt, start, lang="ro")
                self.assertIsNone(ENGLISH.search(text_of(route)), text_of(route))
        partial = self.tour.plan("B413A", 355, lang="ro")
        self.assertIn("la holul cu vitrine, la etajul 4, în Corpul B", partial["notice"])
        self.assertEqual(partial["steps"][-1]["instruction"],
                         "Turul se termină aici, la etajul 4, în Corpul B. Caută B413A la acest etaj.")
        self.assertIn("B520 este cu un etaj mai sus pe scările din ultima imagine, la etajul 5",
                      self.tour.plan("B520", 355, lang="ro")["notice"])
        self.assertIn("lângă Sala C401", self.tour.plan("C402", 314, lang="ro")["notice"])

    def test_checkpoints_answer_to_their_names_in_either_language(self):
        stairs = self.tour.by_id["panorama_181CD06E_39DC_CB88_41A4_8A3FC81F293E"]
        for query in ("Rear exit stairs", "Scara ieșirii din spate", "scara iesirii din spate", f"punctul {stairs}"):
            with self.subTest(query=query):
                self.assertEqual(self.tour.search(query, strict=True)[0]["index"], stairs)
        unnamed = next(i for i, r in self.tour.records.items() if r["name"] == f"Checkpoint {i}")
        self.assertEqual(self.tour.localized(self.tour.records[unnamed], "ro")["name"], f"Punctul {unnamed}")
        self.assertIs(self.tour.localized(self.tour.records[unnamed], "en"), self.tour.records[unnamed])

    def test_directions_do_not_read_out_bare_checkpoint_numbers(self):
        # Along the street from the conference centre toward the Electro forecourt no checkpoint has a name.
        for lang, turn in (("en", "Turn around and keep going."), ("ro", "Întoarce-te și mergi mai departe.")):
            steps = self.tour.route(111, 108, lang)["steps"]
            said = [step["instruction"] for step in steps[:-1]]
            self.assertEqual(len(said), 2)
            self.assertFalse([text for text in said if re.search(r"Checkpoint|Punctul|toward|spre", text)])
            # The heading still identifies the checkpoint, so it can be found in the tour.
            self.assertRegex(steps[1]["name"], r"^(Checkpoint|Punctul) \d+$")
            self.assertEqual(direction(0, {"kind": "walk", "yaw": 180}, None, lang), turn)
        self.assertEqual(self.tour.mention(355, "en"), "the AC entrance")
        self.assertEqual(self.tour.mention(355, "ro"), "intrarea AC")
        self.assertEqual(self.tour.mention(108, "ro"), "Punctul 108")

    def test_checked_landmarks_are_translated_in_full(self):
        for scene, note in self.tour.annotations.items():
            with self.subTest(scene=scene):
                self.assertEqual("name" in note, "name" in note.get("ro", {}))
                self.assertEqual("name" in note, "mention" in note)
                self.assertEqual("name" in note, "mention" in note.get("ro", {}))
                self.assertEqual(set(note.get("toward", {})), set(note.get("ro", {}).get("toward", {})))

    def test_questions_are_asked_in_the_requested_language(self):
        with self.assertRaises(RouteQuestion) as unknown:
            self.tour.plan("Z999", 355, lang="ro")
        self.assertIn("No indexed room or checkpoint matches “Z999”", str(unknown.exception))
        self.assertIn("nu se potrivește cu „Z999”", unknown.exception.text("ro"))
        reply = self.client.post("/api/routes", json={"prompt": "De la Hol Principal la B419", "lang": "ro"})
        body = reply.get_json()
        self.assertEqual((reply.status_code, body["field"]), (422, "start"))
        self.assertEqual(body["message"], "Se potrivesc mai multe locuri. Alege sala sau clădirea la care te referi.")
        self.assertIn("Holul principal", {option["name"] for option in body["options"]})
        english = self.client.post("/api/routes", json={"prompt": "Go to B419", "lang": "de"}).get_json()
        self.assertEqual(english["message"], "Where are you starting? Choose a checkpoint you recognize.")

    def test_api_serves_records_in_the_requested_language(self):
        ro = self.client.get("/api/example?lang=ro").get_json()
        en = self.client.get("/api/example").get_json()
        self.assertEqual((ro["lang"], ro["steps"][0]["name"], en["steps"][0]["name"]), ("ro", "Intrarea AC", "AC entrance"))
        # Both languages ship a rendered example, each under its own key.
        self.assertEqual((ro["video"]["state"], en["video"]["state"]), ("ready", "ready"))
        self.assertNotEqual(ro["video"]["key"], en["video"]["key"])
        with self.client.get(ro["video"]["url"]) as movie:
            self.assertEqual(movie.status_code, 200)
        for lang, example in EXAMPLES.items():
            manifest = json.loads(example.with_suffix(".json").read_text(encoding="utf-8"))
            self.assertEqual(manifest["key"], video_key(self.tour, self.tour.example(lang)))
        named = lambda lang: self.client.get("/api/checkpoints", query_string={"q": "#355", "lang": lang}).get_json()[0]["name"]
        self.assertEqual((named("ro"), named("en")), ("Intrarea AC", "AC entrance"))
        pins = self.client.get("/api/checkpoints?pins=1&lang=ro").get_json()
        self.assertEqual(len(pins), 24)
        rooms = self.client.get("/api/classrooms", query_string={"q": "neconfirmată", "lang": "ro", "limit": 5}).get_json()
        self.assertGreater(rooms["total"], 0)
        self.assertTrue(all(room["area"].endswith("clădire neconfirmată") for room in rooms["items"]))
        # Asked from inside the amphitheatre, so that the test does not start a render.
        d1 = self.client.post("/api/routes", json={"prompt": "D1", "start": 862, "lang": "ro"}).get_json()
        self.assertIsNone(d1["video"])
        titles = {source["title"] for source in d1["destination"]["sources"]}
        self.assertIn("Turul virtual UPT 360°", titles)
        self.assertFalse([title for title in titles if "timetable" in title])

    def test_video_caption_counts_checkpoints_in_the_route_language(self):
        step = self.tour.example("ro")["steps"][0]
        layers = [video.caption(step, 0, 12, lang) for lang in LANGUAGES]
        self.assertEqual(layers[0].size, (video.WIDTH, video.HEIGHT))
        # "PUNCTUL" is shorter than "CHECKPOINT", so its pill ends sooner.
        widths = [layer.crop((0, 22, video.WIDTH // 2, 56)).getbbox()[2] for layer in layers]
        self.assertLess(widths[1], widths[0])

    def test_interface_catalogue_covers_both_languages_and_every_use(self):
        source = (ROOT / "static" / "i18n.js").read_text(encoding="utf-8")
        blocks = {lang: source.split(f"\n  {lang}: {{\n", 1)[1].split("\n  },\n", 1)[0] for lang in LANGUAGES}
        keys = {lang: set(re.findall(r"^    (\w+):", block, re.M)) for lang, block in blocks.items()}
        self.assertEqual(keys["en"], keys["ro"])
        page = (ROOT / "static" / "index.html").read_text(encoding="utf-8")
        script = (ROOT / "static" / "app.js").read_text(encoding="utf-8")
        # The page names every key literally, so a misspelt or unused one shows up here.
        used = set(re.findall(r'data-i18n(?:-\w+)?="(\w+)"', page)) | set(re.findall(r'\bt\("(\w+)"', script))
        self.assertEqual(re.findall(r"\bt\((?!\")", script), [])
        self.assertEqual(used - keys["en"], set())
        self.assertEqual(keys["en"] - used - {"title"}, set())


if __name__ == "__main__":
    unittest.main()
