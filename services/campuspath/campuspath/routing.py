import hashlib
import heapq
import json
import math
import re
from urllib.parse import parse_qs, urlencode, urlsplit

from .classrooms import Classrooms
from .import_tour import normalized
from .source import ROOT, SNAPSHOT, TOUR, tour_url
from .text import LANGUAGES, WAYS, floor_phrase, floors_away, move, say

SECONDS_PER_STOP = 3
# Typical metres between linked checkpoints when neither, one or both of them stand outdoors.
# Indoor hotspots sit about 6 m away. The campus map's building pins put outdoor panoramas
# 30 to 80 m apart, far beyond where their hotspots are drawn. A larger outdoor figure
# trades single courtyard steps for long indoor detours.
HOP_METRES = (8, 22, 40)
CAMERA_HEIGHT = 1.7  # The tour player measures the distance to a hotspot on the floor from this height.
EXAMPLE_START = "panorama_7C6A13D7_23C6_1DC1_41AB_E8C1503CF2B2"
EXAMPLE_END = "panorama_1819A98C_39DC_FC88_41B2_B91A7036DD57"

FILLER = set("""
    a am and at by can care catre cea cel cum de do din direction directions drive
    du fac facultatea find for from get give go guide how i im in is la laborator
    laboratorul lab laboratory lead location ma me mi my navigate of on path
    pana please reach room route sala show spre sunt take tell the to unde
    vreau want way where would you your sa ajung merg cat se pe un o as like can
    video walk walking walkthrough checkpoint point punctul punct could help would
""".split())


class RouteQuestion(Exception):
    def __init__(self, key, field, options=(), *, choose=False, **words):
        super().__init__(say("en", key, **words))
        self.key = key
        self.words = words
        self.field = field
        self.options = list(options)
        self.choose = choose or bool(self.options)

    def text(self, lang):
        return say(lang, self.key, **self.words)


def terms(text):
    text = normalized(text)
    for pattern, replacement in (
        (r"\bmain (?:hall|lobby)\b", "hol principal"), (r"\blobby\b", "hol principal"),
        (r"\blibrary\b", "biblioteca"), (r"\bentrance\b", "intrare"),
        (r"\bac\b", "automatica calculatoare"), (r"\bfloor\b", "et"),
    ):
        text = re.sub(pattern, replacement, text)
    # B 419, B-419 and B419 refer to the same room.
    text = re.sub(r"\b([a-z]) (\d{2,}[a-z]?)\b", r"\1\2", text)
    return set(text.split()) - FILLER - {"si"}


def split_request(prompt):
    """Return optional origin text and destination text without losing room codes."""
    end = r"(?:\bto\b|\btowards?\b|\bp[âa]n[ăa]\s+la\b|\bc[ăa]tre\b|\bspre\b|\bla\b)"
    source = re.search(r"\b(?:from|de\s+la|din)\s+", prompt, re.I)
    if source:
        after = prompt[source.end():]
        pair = re.split(end, after, maxsplit=1, flags=re.I)
        if len(pair) == 2 and all(s.strip() for s in pair):
            return pair[0].strip(), pair[1].strip()
        return after.strip(), prompt[:source.start()].strip()
    at = re.search(
        r"\b(?:i(?:['’]m| am) (?:currently )?(?:at|in)|sunt (?:la|in|în))\s+(.+?)(?:[,.;]|\s+(?:and|și|si)\s+)"
        r"\s*(.+)$", prompt, re.I,
    )
    return (at[1].strip(), at[2].strip()) if at else (None, prompt.strip())


def tour_reference(query):
    value = query.strip()
    if value.startswith("https://"):
        url = urlsplit(value)
        if url.netloc != urlsplit(TOUR).netloc:
            return None, ""
        fragment = parse_qs(url.fragment or url.query)
        value = next((fragment[k][0] for k in ("media", "media-index", "media-name") if k in fragment), "")
        if not value.isdigit():
            return None, value
        return int(value), ""
    match = re.fullmatch(r"(?:#|(?:checkpoint|punct(?:ul)?)\s*#?\s*)(\d+)", value, re.I)
    return (int(match[1]), "") if match else (None, value)


class Tour:
    def __init__(self, path=SNAPSHOT):
        raw = path.read_bytes()
        notes = (ROOT / "data" / "landmarks.json").read_bytes()
        source = json.loads(raw)
        self.revision = source["revision"]
        self.signature = hashlib.sha256(raw + notes).hexdigest()
        self.scenes = {s["index"]: s for s in source["scenes"]}
        self.by_id = {s["id"]: s["index"] for s in self.scenes.values()}
        self.annotations = json.loads(notes)
        self.records = {}
        self.search_fields = {}
        self.outdoors = set()
        self.names = {lang: {} for lang in LANGUAGES[1:]}
        self.mentions = {lang: {} for lang in LANGUAGES}
        for index, scene in self.scenes.items():
            note = self.annotations.get(scene["id"], {})
            # A checked note overrides what the importer read from the panorama's sky.
            if note.get("open", scene.get("open")):
                self.outdoors.add(index)
            raw_name = scene["label"]
            generic = not raw_name or re.fullmatch(r"R\d+(?:\s*copy)?", raw_name, re.I)
            name = note.get("name") or (say("en", "checkpoint", index=index) if generic else raw_name)
            for lang, mentions in self.mentions.items():
                # "the main hall" reads better inside a sentence than the heading "Main hall".
                inline = (note if lang == "en" else note.get(lang, {})).get("mention")
                if inline:
                    mentions[index] = inline
            for lang, names in self.names.items():
                # A checked name without a translation is shown as it is.
                local = note.get(lang, {}).get("name")
                if local or (generic and "name" not in note):
                    names[index] = local or say(lang, "checkpoint", index=index)
            floor = re.search(r"\bEt\.?\s*(\d+)\b", raw_name, re.I)
            record = {
                "index": index, "name": name, "label": raw_name, "area": scene["area"],
                # A floor read from signs and door plates outranks the tour's label.
                "floor": note["floor"] if "floor" in note else int(floor[1]) if floor else None,
                "named": not generic or "name" in note,
                "thumb": tour_url(scene["thumb"]), "url": f"{TOUR}#media={index}",
            }
            if "pin" in scene:
                record["pin"] = scene["pin"]
            self.records[index] = record
            aliases = [name, raw_name, *note.get("aliases", []), *(names.get(index) for names in self.names.values())]
            self.search_fields[index] = ([terms(v) for v in aliases if v], terms(scene["area"]))
        self.classrooms = Classrooms(self)

    def localized(self, record, lang):
        """A checkpoint or classroom record with its checkpoint named in the requested language."""
        names = self.names.get(lang)
        if not names or record is None:
            return record
        if "coverage" in record:
            titles = self.classrooms.titles[lang]
            return dict(record, checkpointName=names.get(record["checkpoint"], record["checkpointName"]),
                        area=self.classrooms.areas[lang].get(record["area"], record["area"]),
                        sources=[dict(s, title=titles.get(s["title"], s["title"])) for s in record["sources"]])
        return dict(record, name=names.get(record["index"], record["name"]))

    def mention(self, index, lang):
        """A checkpoint's name as it reads inside a sentence."""
        return self.mentions[lang].get(index) or self.localized(self.records[index], lang)["name"]

    def search(self, query, *, strict=False):
        original = query
        number, query = tour_reference(query)
        if number is not None:
            return [self.records[number]] if number in self.records else []
        if original.strip() and not query:
            return []
        if query in self.by_id:
            return [self.records[self.by_id[query]]]
        wanted = terms(query)
        ranked = []
        codes = {word for word in wanted if re.fullmatch(r"[a-z]{1,3}\d+[a-z]?", word)}
        for index, (aliases, area) in self.search_fields.items():
            record = self.records[index]
            if not wanted:
                if strict or query.strip():
                    continue
                score = 2 if "pin" in record else 1 if record["named"] else 0
            else:
                candidates = set.union(set(), *aliases)
                available = candidates | area
                if wanted in aliases:
                    score = 6
                elif wanted <= candidates:
                    score = 5
                elif wanted <= available:
                    score = 4
                elif strict and len(codes) == 1 and codes <= terms(record["label"]):
                    # A precise, published room code also works inside free-form prose.
                    score = 1
                elif not strict and all(
                    word in available if any(c.isdigit() for c in word)
                    else any(v.startswith(word) for v in available) for word in wanted
                ):
                    score = 2
                else:
                    continue
            ranked.append((score, record))
        ranked.sort(key=lambda item: (-item[0], not item[1]["named"], item[1]["name"], item[1]["index"]))
        if strict and ranked:
            ranked = [item for item in ranked if item[0] == ranked[0][0]]
        return [record for _, record in ranked]

    def places(self, query):
        matches = self.search(query, strict=True)
        number, value = tour_reference(query)
        if number is not None or value in self.by_id or query.strip().startswith("https://"):
            return matches
        if matches and terms(query) & {"doorway", "entrance", "intrare", "intrarea", "hall", "hol", "stairwell", "landing", "corridor"}:
            return matches
        rooms = self.classrooms.search(query, strict=True)
        if rooms:
            return rooms
        return matches

    def resolve(self, query, field, choice=None):
        valid_scene = type(choice) is int and choice in self.scenes
        valid_room = isinstance(choice, str) and choice in self.classrooms.records
        if choice is not None and not (valid_room or valid_scene):
            raise RouteQuestion("ask.outside", field)
        if valid_room and query:
            room = self.classrooms.records[choice]
            if query.strip() in (room["code"], room["label"], room["name"], *room["aliases"]):
                return choice
        if not query:
            if choice is not None:
                return choice
            raise RouteQuestion("ask.start" if field == "start" else "ask.destination", field, choose=field == "start")
        matches = self.places(query)
        for record in matches:
            if choice is not None and (record["index"] == choice or
                    (record.get("coverage") == "exact" and choice == record["checkpoint"])):
                return record["index"]
        if field == "start" and valid_scene and len(matches) == 1 and matches[0].get("coverage") == "unmapped":
            return choice
        if len(matches) == 1:
            return matches[0]["index"]
        if matches:
            raise RouteQuestion("ask.several", field, matches)
        raise RouteQuestion("ask.unknown", field, query=query)

    def plan(self, prompt, start=None, destination=None, lang="en", origin=None):
        """Plan a route. A link or form can name the starting place apart from the request, as origin."""
        if not isinstance(prompt, str) or len(prompt) > 1000 or not isinstance(origin, (str, type(None))) or len(origin or "") > 200:
            raise RouteQuestion("ask.length", "destination")
        origin_text, end_text = split_request(prompt)
        if origin and origin.strip():
            # As in a link, a bare number is a checkpoint, not a room code.
            origin_text = "#" + origin.strip() if origin.strip().isdecimal() else origin.strip()
        if not origin_text:
            pair = re.split(r"\s+(?:to|spre|către|catre|→|->)\s+", prompt, maxsplit=1, flags=re.I)
            if len(pair) == 2 and self.places(pair[0]):
                origin_text, end_text = pair
        if origin_text and normalized(origin_text) in {
            "here", "my location", "my current location", "the closest checkpoint", "the nearest checkpoint",
            "locatia mea", "locatia curenta", "cel mai apropiat checkpoint", "aici",
        }:
            origin_text = None
        end = self.resolve(end_text, "destination", destination)
        room = self.localized(self.classrooms.records.get(end), lang)
        if room and room["coverage"] == "unmapped":
            return {"steps": [], "duration": 0, "lang": lang, "coverage": "unmapped", "destination": room,
                    "notice": say(lang, "notice.unmapped")}
        origin = self.resolve(origin_text, "start", start)
        start_room = self.localized(self.classrooms.records.get(origin), lang)
        if start_room and start_room["checkpoint"] is None:
            raise RouteQuestion("ask.start_room", "start", choose=True)
        route = self.route(start_room["checkpoint"] if start_room else origin, room["checkpoint"] if room else end, lang)
        route["coverage"] = room["coverage"] if room else "exact"
        # One checkpoint is a place, not a walk: describe it instead of rendering a still video.
        waiting = len(route["steps"]) == 1
        last = route["steps"][-1]
        notices = []
        if start_room:
            route["origin"] = start_room
            if start_room["coverage"] == "checkpoint" and not waiting:
                notices.append(say(lang, "notice.start", place=self.mention(start_room["checkpoint"], lang)))
                route["steps"][0]["caption"] = say(lang, "caption.start",
                                                   room=start_room["code"] or say(lang, "your classroom"))
        if room:
            route["destination"] = room
            if room["coverage"] == "checkpoint":
                target = room["code"] or room["label"]
                notice, last["instruction"], floor = partial_arrival(
                    room, self.mention(room["checkpoint"], lang), target,
                    say(lang, "the classroom") if len(target) > 60 else target, waiting, lang)
                notices.append(notice)
                if floor is not None:
                    last["floor"] = floor
                look = (room.get("anchor") or {}).get("look")
                if look:
                    # End facing the stairs that lead on, not the panorama's opening view.
                    last.update(yaw=look[0], pitch=look[1], url=view_url(last["index"], *look))
            elif waiting:
                notices.append(say(lang, "notice.already", place=room["name"]))
            elif room["code"] and room["code"].casefold() not in last["name"].casefold():
                last["caption"] = room["name"]
        elif waiting:
            notices.append(say(lang, "notice.already", place=self.mention(last["index"], lang)))
        if waiting:
            route["duration"] = 0
        if notices:
            route["notice"] = " ".join(notices)
        return route

    def reach(self, start, end=None):
        """Predecessors on the shortest estimated walk to every checkpoint reachable from start (or until end)."""
        # Routes of equal length are ranked by how near the tour draws their hotspots.
        best = {start: (0, 0)}
        visited = {start: None}
        pending = [(0, 0, start)]
        while pending:
            metres, markers, current = heapq.heappop(pending)
            if current == end:
                break
            if (metres, markers) > best[current]:
                continue
            for edge in self.scenes[current]["links"]:
                target = edge["to"]
                cost = (metres + HOP_METRES[(current in self.outdoors) + (target in self.outdoors)],
                        markers + marker_distance(edge["pitch"]))
                if target not in best or cost < best[target]:
                    best[target] = cost
                    visited[target] = (current, edge)
                    heapq.heappush(pending, (*cost, target))
        return visited

    def route(self, start, end, lang="en"):
        visited = self.reach(start, end)
        if end not in visited:
            raise RouteQuestion("ask.disconnected", "start")
        path = [end]
        edges = []
        while path[-1] != start:
            previous, edge = visited[path[-1]]
            path.append(previous)
            edges.append(edge)
        path.reverse()
        edges.reverse()
        steps = []
        for i, index in enumerate(path):
            scene = self.scenes[index]
            step = dict(self.localized(self.records[index], lang), time=i * SECONDS_PER_STOP)
            incoming = edges[i-1]["back"] if i > 0 else None
            step["arrivalYaw"] = (incoming + 180) % 360 if incoming is not None else None
            if i < len(edges):
                edge = edges[i]
                target = self.scenes[edge["to"]]
                note = self.annotations.get(scene["id"], {})
                # A direction checked against the view replaces the one worked out from the bearing.
                checked = (note if lang == "en" else note.get(lang, {})).get("toward", {})
                # A checkpoint known only by its number is not worth reading out.
                named = self.mention(edge["to"], lang) if self.records[edge["to"]]["named"] else None
                if named and len(named.split()) > 5:
                    named = None  # A long name is a heading, not something to walk toward.
                # What the way ahead is: checked in the pictures, or a building's threshold.
                way = note.get("ways", {}).get(target["id"])
                if way is None and (index in self.outdoors) != (edge["to"] in self.outdoors):
                    way = "enter_building" if index in self.outdoors else "leave_building"
                # Stairs are worth a floor only when they end on a different one.
                floor = self.records[edge["to"]]["floor"]
                default = direction(step["arrivalYaw"], edge, named, lang, way, None if floor == step["floor"] else floor)
                step.update(yaw=edge["yaw"], pitch=edge["pitch"], kind=edge["kind"],
                            instruction=checked.get(target["id"], default))
            else:
                step.update(yaw=scene["view"][0], pitch=scene["view"][1], kind="arrival",
                            instruction=say(lang, "step.here" if start == end else "step.arrive"))
            step["url"] = view_url(index, step["yaw"], step["pitch"])
            steps.append(step)
        return {"steps": steps, "duration": len(steps) * SECONDS_PER_STOP, "lang": lang}

    def example(self, lang="en"):
        return self.route(self.by_id[EXAMPLE_START], self.by_id[EXAMPLE_END], lang)


def view_url(index, yaw, pitch):
    """The same view in the original tour."""
    return TOUR + "#" + urlencode({"media": index, "yaw": yaw, "pitch": pitch, "fov": 84})


def marker_distance(pitch):
    """Metres to a hotspot as the tour player measures it. A marker near the horizon is not on the floor."""
    return CAMERA_HEIGHT / math.tan(math.radians(-pitch)) if pitch <= -3 else HOP_METRES[0]


def partial_arrival(room, place, target, short, waiting=False, lang="en"):
    """Notice, closing caption and floor for a route that stops short of the room itself."""
    anchor = room.get("anchor") or {"at": None}
    if anchor.get("beside"):
        place += say(lang, "partial.beside", room=anchor["beside"])
    floor = anchor["at"] if type(anchor["at"]) is int else None
    words = {"target": target, "short": short, "Short": short[:1].upper() + short[1:]}
    def on(floor, wing):
        """The place with its floor, unless its name already states it."""
        bare = floor_phrase(lang, floor).split(" ", 1)[1].removeprefix("the ")
        stated = bare.lower() in place.lower().replace("-", " ") or re.search(rf"\bEt\.? ?{floor}\b", place)
        if not stated:
            return place + ", " + floor_phrase(lang, floor, wing)
        if not wing or re.search(rf"\bcorp(?:ul|ului)? {wing}\b", place, re.I):
            return place
        return place + (f", în Corpul {wing}" if lang == "ro" else f", in Corp {wing}")

    if anchor.get("door"):
        # The room's plate was read from this checkpoint: the last view faces its door.
        kind = "doorhere" if waiting else "door"
        if anchor.get("floor") is not None:
            place = on(anchor["floor"], anchor["wing"])
    elif "floor" not in anchor:
        # No floor is known: the route ends at a checkpoint a register named, or at the entrance.
        kind = room["reach"]
    elif anchor["at"] is None:
        kind, words["zone"] = "unseen", floor_phrase(lang, anchor["floor"], anchor["wing"])
    elif anchor["at"] == anchor["floor"]:
        kind, words["zone"] = "floor", floor_phrase(lang, anchor["floor"], anchor["wing"])
        place = on(anchor["floor"], anchor["wing"])
    else:
        # The stairs are only "in the last view" when there is a video to show them.
        kind = "stairs" if "look" in anchor and not waiting else "away"
        words.update(move=floors_away(lang, anchor["floor"] - anchor["at"]), zone=floor_phrase(lang, anchor["floor"]))
        place = on(anchor["at"], anchor["wing"])
    notice = say(lang, "partial.waiting" if waiting else "partial.ends", place=place, target=target,
                 beyond=say(lang, f"partial.{kind}.beyond", **words))
    return notice, say(lang, f"partial.{kind}.caption", **words), floor


def direction(arrival, edge, next_name, lang="en", way=None, floor=None):
    """What to do at a checkpoint, from the bearing walked in on and the hotspot that leads on.

    way is what the pictures show ahead (stairs, a corridor, a door). floor is the next checkpoint's.
    """
    if edge["kind"] == "door":
        key = "step.door"
    elif arrival is None:
        key = "step.follow"
    else:
        turn = (edge["yaw"] - arrival + 180) % 360 - 180
        side = "right" if turn > 0 else "left"
        if abs(turn) < 25:
            key = "step.ahead"
        elif abs(turn) < 60:
            key = "step.bear." + side
        elif abs(turn) < 145:
            key = "step.turn." + side
        else:
            key = "step.back"
    if way in WAYS:
        return move(lang, key, way, next_name, floor)
    return say(lang, key, next=next_name) if next_name else say(lang, key + ".plain")
