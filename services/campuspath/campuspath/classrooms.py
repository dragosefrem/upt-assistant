"""Search the physical room catalogue independently of the panorama graph."""
import json
import re
import unicodedata
from collections import defaultdict
from urllib.parse import urlsplit, urlunsplit

from .source import ROOT
from .text import LANGUAGES

CATALOGUE = ROOT / "data" / "classrooms.json"
CODE = re.compile(r"(?:[a-z]{0,5}\d+[a-z]*(?:[-/]\d+[a-z]*)*|[a-z]{1,5})$")
PREFIX = r"(aspc|spm|orol|lg|ca|mz|[a-hkm-pr-tv])"
NOISE = set("""
a am an and at can catre cea checkpoint classroom classrooms course cum de din do du
et etaj etajul fac faculty facultatea find for from get give go how i in is la lab
laborator laboratorul laboratory le ma me mi my of please room sala salile sali seminar
show si spre sunt take the to vreau want where you your sa ajung merg can could would
guide video path navigate amfiteatrul amfiteatru
""".split())


def fold(value):
    text = unicodedata.normalize("NFKD", value.casefold())
    return "".join(c for c in text if not unicodedata.combining(c))


def tokens(value):
    text = fold(value).replace("–", "-").replace("‑", "-").replace("−", "-")
    # Some faculty timetables put the building last, including shared rooms such as "106/115 SPM".
    text = re.sub(r"\b(\d{3}[a-z]?(?:\s*/\s*\d{3}[a-z]?)*)\s+spm\b",
                  lambda m: " ".join("spm" + room.strip() for room in m[1].split("/")), text)
    # A building written beside the room: "CEL 403" and "CEL401" are C403 and C401 in CeL,
    # "206 Orologerie" is O206, "A2CH" is A2 at Chimie, "MEC-N301" is N301.
    text = re.sub(r"\bcel[ -]?(\d{3})\b", r"c\1 cel", text)
    text = re.sub(r"\borologerie\s+(\d{3}[a-z]?)\b|\b(\d{3}[a-z]?)\s+orologerie\b",
                  lambda m: f"o{m[1] or m[2]} orologerie {m[1] or m[2]}", text)
    text = re.sub(r"\b([a-z]\d{1,3})ch\b", r"\1 ch", text)
    text = re.sub(r"\b(mec|mpt|chimie|ch)\s*-\s*(?=[a-z]?\d)", r"\1 ", text)
    text = re.sub(r"\b" + PREFIX + r"[ -]+(?=\d)", r"\1", text)
    text = re.sub(r"(\d)\s+([abcd])\b", r"\1\2", text)
    text = re.sub(r"(?<=\d)\s*([-/])\s*(?=\d)", r"\1", text)
    return re.findall(r"[a-z0-9]+(?:[-/][a-z0-9]+)*", text)


def words(value):
    parts = set(tokens(value))
    for term, extra in {"ac": "automatica calculatoare", "civil": "constructii",
                        "chemistry": "chimie", "architecture": "arhitectura",
                        "mechanical": "mecanica", "management": "management",
                        # As timetables shorten them: "A303 Ch", "MEC - M304".
                        "ch": "chimie", "mec": "mecanica"}.items():
        if term in parts:
            parts.update(extra.split())
    return parts - NOISE


def name_key(value):
    keep = {"sala", "lab", "laborator", "laboratorul", "amfiteatru", "amfiteatrul", "seminar", "salile", "sali"}
    return tuple(t for t in tokens(value) if t not in NOISE or t in keep)


LEVELS = {"parter": 0, "mezanin": "M", "demisol": -1, "mansarda": "A"}


def stated_floor(text):
    """Floor named by a catalogue level or a tour label such as "Lab. B419 - Et.4"."""
    text = fold(text or "")
    match = re.search(r"\bet(?:aj(?:ul)?)?\.?\s*(\d+)\b", text)
    if match:
        return int(match[1])
    return next((floor for word, floor in LEVELS.items() if re.search(rf"\b{word}\b", text)), None)


def coded_zone(code, pattern):
    """(wing, floor) for a room code that follows the building's numbering, e.g. B413A."""
    match = re.fullmatch(pattern, code.replace(" ", ""), re.I) if pattern and code else None
    return ((match.groupdict().get("wing") or "").upper(), int(match["floor"])) if match else None


def source_link(ref, sources):
    key, _, fragment = ref.partition("#")
    source = sources[key]
    if not source.get("url"):
        return {"title": source["title"], "url": None}
    url = urlsplit(source["url"])
    return {"title": source["title"], "url": urlunsplit(url._replace(fragment=fragment or url.fragment))}


class Classrooms:
    def __init__(self, tour, path=CATALOGUE):
        data = json.loads(path.read_text(encoding="utf-8"))
        self.as_of = data["asOf"]
        # Building names and source titles in another language, where the catalogue's wording is English.
        self.areas, self.titles = (
            {lang: {entry[key]: entry[lang] for entry in data[group].values() if lang in entry} for lang in LANGUAGES[1:]}
            for group, key in (("sites", "name"), ("sources", "title")))
        self.records = {}
        self.by_scene = {}
        self.codes = defaultdict(set)
        self.names = defaultdict(set)
        self.fields = {}
        self.sites = {}
        self.entrances = {key: tour.by_id[site["checkpoint"]] for key, site in data["sites"].items()
                          if site.get("checkpoint") in tour.by_id}
        # Buildings whose name in a request rules out a room with the same code elsewhere.
        self.only = defaultdict(set)
        self.named = {}
        for key, site in data["sites"].items():
            aliases = site.get("aliases", []) if site.get("only") else []
            for alias in aliases:
                self.only[fold(alias)].add(key)
            if aliases:
                self.named[fold(aliases[0])] = key
        rows = []
        outside = defaultdict(list)
        reach = {}
        for row in data["rooms"]:
            site = data["sites"][row["site"]]
            scene = tour.by_id.get(row.get("scene"))
            coded = coded_zone(row.get("code", ""), site.get("zones"))
            zone = coded
            if zone is None and site.get("floors"):
                # A bare floor only places a room in a building with a single stack of floors.
                floor = stated_floor(tour.scenes[scene]["label"]) if scene else None
                if floor is None:
                    floor = stated_floor(row.get("level"))
                zone = None if floor is None else ("", floor)
            entrance = tour.by_id.get(site.get("checkpoint"))
            rows.append((row, site, scene, zone, coded, entrance))
            if scene is None or zone is None or entrance is None:
                continue
            # The checkpoint a student walks through just before a room with its own panorama
            # stands on that room's floor, so it can anchor neighbours the tour never entered.
            if entrance not in reach:
                reach[entrance] = tour.reach(entrance)
            hops, step = 0, scene
            while step != entrance and step in reach[entrance]:
                step, hops = reach[entrance][step][0], hops + 1
            if step == entrance and hops:
                outside[row["site"]].append((hops, reach[entrance][scene][0], zone, row["name"]))
        for found in outside.values():
            found.sort(key=lambda v: v[:2])  # Fewest hotspots from the entrance first.
        for row, site, scene, zone, coded, entrance in rows:
            rid = "room:" + row["id"]
            if rid in self.records:
                raise ValueError(f"Duplicate classroom id {rid}")
            checkpoint = scene or tour.by_id.get(row.get("checkpoint"))
            anchor = None
            door = row.get("door") if scene is None else None
            if door and door["scene"] in tour.by_id:
                # The room's plate is legible from this checkpoint: end there, facing the door.
                checkpoint = tour.by_id[door["scene"]]
                anchor = {"door": True, "look": [door["yaw"], door["pitch"]], "at": zone[1] if zone else None,
                          "wing": zone[0] if zone else "", "floor": zone[1] if zone else None}
            elif checkpoint is None and zone and row.get("near") in tour.by_id:
                # A survey placed the room on a corridor of its floor without reading its plate.
                checkpoint = tour.by_id[row["near"]]
                anchor = {"floor": zone[1], "wing": zone[0], "at": zone[1], "checkpoint": checkpoint}
            elif checkpoint is None:
                if zone:
                    anchor = self.anchor(zone, site, outside[row["site"]], tour)
                    checkpoint = anchor.get("checkpoint")
                if checkpoint is None:
                    checkpoint = entrance
            coverage = "exact" if scene else "checkpoint" if checkpoint else "unmapped"
            # How near the tour gets: into the room, to its floor, to a floor next to it,
            # to a checkpoint a register named, or only to the building's entrance.
            if coverage != "checkpoint":
                reach = "room" if scene else "none"
            elif anchor and anchor.get("door"):
                reach = "door"
            elif anchor and anchor.get("checkpoint") is not None:
                reach = "floor" if anchor["at"] == anchor["floor"] else "near"
            else:
                reach = "checkpoint" if row.get("checkpoint") in tour.by_id else "entrance"
            aliases = row.get("aliases", [])
            code, label = row.get("code", ""), row["name"]
            name = label if not code or set(tokens(code)) <= set(tokens(label)) else f"{code} · {label}"
            point = tour.records.get(checkpoint, {})
            # Where the code states the floor, show it instead of a conflicting register entry.
            level = ("Parter" if coded[1] == 0 else f"Etaj {coded[1]}") if coded else row.get("level")
            record = {
                "index": rid, "code": code, "name": name, "label": label, "area": site["name"],
                # What timetables call the building, e.g. "MPT" for Str. Remus 14.
                "areaAliases": site.get("aliases", []),
                "faculties": row.get("faculties", []), "level": level,
                "coverage": coverage, "reach": reach, "checkpoint": checkpoint, "checkpointName": point.get("name"),
                "thumb": point.get("thumb"), "url": point.get("url"), "aliases": aliases,
                "sources": [source_link(ref, data["sources"]) for ref in row["sources"]],
            }
            if anchor and coverage == "checkpoint":
                record["anchor"] = {k: v for k, v in anchor.items() if k != "checkpoint"}
            if scene is not None:
                if scene in self.by_scene:
                    raise ValueError(f"Two catalogue entries claim panorama {scene}")
                self.by_scene[scene] = rid
            self.records[rid] = record
            for value in [code, *aliases]:
                t = tokens(value)
                if len(t) == 1 and CODE.fullmatch(t[0]) and (value == code or any(c.isdigit() for c in value)):
                    self.codes[t[0]].add(rid)
            names = [words(v) for v in [label, code, *aliases] if v]
            for value in [label, *aliases]:
                key = name_key(value)
                if len(key) > 1:
                    self.names[key].add(rid)
            building = " ".join([site["name"], *site.get("aliases", []), *(site[lang] for lang in LANGUAGES[1:] if lang in site)])
            self.fields[rid] = (names, words(building), words(" ".join(record["faculties"])))
            self.sites[rid] = row["site"]

    @staticmethod
    def anchor(zone, site, outside, tour):
        """Closest verified checkpoint for a (wing, floor): its own floor first, then the next one."""
        wing, floor = zone
        found = {"floor": floor, "wing": wing, "at": None}
        fixed = site.get("anchors", {}).get(f"{wing}{floor}")
        if fixed and fixed["checkpoint"] in tour.by_id:
            # "look" turns the last view toward the stairs that lead on to the room's floor.
            look = {"look": fixed["look"]} if "look" in fixed else {}
            return dict(found, checkpoint=tour.by_id[fixed["checkpoint"]], at=fixed.get("floor", floor), **look)
        # A neighbouring floor helps when it is in the right wing or closer than the entrance.
        nearby = [floor - 1, floor + 1] if isinstance(floor, int) and (wing or floor >= 2) else []
        for at in [floor, *nearby]:
            for _, checkpoint, place, room in outside:
                if place == (wing, at):
                    return dict(found, checkpoint=checkpoint, at=at, beside=room)
        return found

    def codes_in(self, token):
        """The room codes one word of a request stands for."""
        if token in self.codes:
            return {token}
        # "ASPC 113" is room 113 in ASPC. Rooms listed there as A306 are also written "ASPC 306".
        prefixed = re.fullmatch(r"aspc(\d{3}[a-z]?)", token)
        if prefixed:
            return next(({code} for code in (prefixed[1], "a" + prefixed[1])
                         if any(self.sites[rid] == "aspc" for rid in self.codes.get(code, ()))), set())
        # Two rooms in one cell: "M214/N214", "C402-C403".
        parts = re.split(r"[-/]", token)
        return set(parts) if len(parts) > 1 and all(part in self.codes for part in parts) else set()

    def building(self, query):
        """The one building a request names and nothing else: "Orologerie", "sala SPM"."""
        asked = words(query)
        # A building's first alias is its own name; "SPM" also covers its IMF wing.
        sites = {self.named[word] for word in asked if word in self.named}
        return next(iter(sites)) if len(sites) == 1 and all(word in self.only for word in asked) else None

    def names_building(self, query):
        """Whether a request says which building it means ("A1 SPM")."""
        return any(word in self.only for word in words(query))

    def search(self, query, *, strict=False):
        wanted = words(query)
        key = name_key(query)
        references = re.sub(r"\b(?:et\.?|etaj(?:ul)?|floor)\s*\d+\b", "", fold(query))
        spelled = {token: self.codes_in(token) for token in tokens(references)}
        identifiers = set().union(*spelled.values())
        # A word read as room codes is not also a name to look for.
        read = {token for token, codes in spelled.items() if codes}
        wanted = (wanted - read) | identifiers
        key = tuple(part for part in key if part not in read or part in identifiers)
        only = set().union(*(self.only[word] for word in wanted if word in self.only))
        if any(token.startswith("aspc") and codes for token, codes in spelled.items()):
            only.add("aspc")
        # Beside a room code, "ASPC" names the building, not the room listed as "ASPC".
        buildings = {word for word in identifiers if word in self.only}
        if identifiers - buildings:
            identifiers -= buildings
        if any(any(c.isalpha() for c in identifier) for identifier in identifiers):
            identifiers = {identifier for identifier in identifiers if not identifier.isdigit()}
        meaningful = set(key) - identifiers - {"sala", "room", "lab", "laborator", "laboratorul"}
        if meaningful and key in self.names:
            return [self.records[rid] for rid in sorted(self.names[key])]
        if identifiers and meaningful:
            named = [self.records[rid] for rid, (names, _, _) in self.fields.items()
                     if any(wanted and wanted <= field for field in names)]
            if named:
                return named
        if identifiers:
            matched_ids = set.union(*(self.codes[v] for v in identifiers))
            if not strict:
                matched_ids.update(rid for value, ids in self.codes.items()
                                   if any(value.startswith(v) for v in identifiers) for rid in ids)
            if only:
                # "A206 SPM" is not A206 in ASPC or in Electro. Where the building itself is
                # listed ("ASPC"), an unknown room in it still leads to the building.
                matched_ids = {rid for rid in matched_ids if self.sites[rid] in only} or {
                    rid for word in buildings for rid in self.codes[word] if self.sites[rid] in only}
                identifiers = identifiers | buildings
        else:
            matched_ids = self.records.keys()
        ranked = []
        for rid in matched_ids:
            names, building, faculties = self.fields[rid]
            if identifiers and any(rid in self.codes[v] for v in identifiers):
                context = wanted - identifiers
                score = 20 + 3 * len(context & building) + 2 * len(context & faculties)
                score += max((len(context & field) for field in names), default=0)
            elif not wanted:
                if strict or query.strip():
                    continue
                score = 0
            elif any(wanted == field for field in names):
                score = 15
            elif any(wanted <= field for field in names):
                score = 12
            elif any(wanted <= (field | building | faculties) and wanted & field for field in names):
                score = 9
            elif not strict:
                available = set.union(building, faculties, *names)
                if not all(any(v.startswith(w) for v in available) for w in wanted):
                    continue
                score = 2
            else:
                continue
            ranked.append((score, self.records[rid]))
        ranked.sort(key=lambda v: (-v[0], v[1]["code"] == "", fold(v[1]["name"]), v[1]["area"], v[1]["index"]))
        if strict and ranked:
            ranked = [v for v in ranked if v[0] == ranked[0][0]]
        return [r for _, r in ranked]
