"""Refresh the checkpoint index from the resources referenced by the tour player."""

import json
import math
import re
import tempfile
import unicodedata
from concurrent.futures import ThreadPoolExecutor
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import parse_qs, urlencode, urlsplit
from xml.etree import ElementTree

import cv2
import numpy as np

from .source import SNAPSHOT, TOUR, fetch, tour_url


class TourPage(HTMLParser):
    def __init__(self):
        super().__init__()
        self.script = None
        self.locale = None

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        resource = attrs.get("src" if tag == "script" else "href", "")
        path = urlsplit(resource).path
        if tag == "script" and path.rsplit("/", 1)[-1] == "script.js":
            self.script = resource
        if tag == "link" and path.endswith("locale/ro-RO.txt"):
            self.locale = resource


# Preserve quoted JSON (including embedded action text). Only the player's
# declarative translation calls and script references need substitutions.
JS_VALUES = re.compile(
    r'''"(?:[^"\\]|\\.)*"|\btrans\('([^']+)'(?:[^()']|'[^']*'|regTextVar\([^()]*\))*\)'''
    r"|\b(TDV\.Tour\.Script\.\w+)"
)


def definitions(source):
    literal = source.split("var script = ", 1)[1]

    def replace(match):
        value = match[1] or match[2]
        return json.dumps(value) if value else match[0]

    document, _ = json.JSONDecoder().raw_decode(JS_VALUES.sub(replace, literal))
    return {item["id"]: item for item in document["definitions"] if "id" in item}


def normalized(s):
    s = unicodedata.normalize("NFKD", s.casefold())
    s = "".join(c for c in s if not unicodedata.combining(c))
    return " ".join(re.findall(r"[a-z0-9]+", s))


AREA_NAMES = {
    "fAutomaticaCalculatoare": "Automatică și Calculatoare",
    "fElectronica": "Electronică și Telecomunicații",
    "fInginerieElectrica": "Inginerie Electrică și Energetică",
    "fInginerieChimica": "Inginerie Chimică",
    "fHunedoaraInginerie": "Inginerie Hunedoara",
    "fConstructii": "Construcții",
    "fMecanica": "Mecanică",
    "fArhitectura": "Arhitectură și Urbanism",
    "fManagementTP": "Management în Producție și Transporturi",
    "fStiinte": "Științe ale Comunicării",
    "BibliotecaUPT": "Biblioteca UPT",
    "Centrudeconferinte": "Centrul de Conferințe",
    "ARChA": "ARChA", "BazaSportiva1": "Baza Sportivă 1",
    "BazaSportiva2": "Baza Sportivă 2", "Cantina": "Cantina Studențească",
    "Camin9C": "Căminul 9C", "Camin21C": "Căminul 21C",
    "Rectorat": "Rectorat UPT", "cel": "CeL – ID/IFR",
    "CCOC": "CCOC", "METAMV": "META MV", "ICER": "ICER",
    "CampusCreativ": "Campus Creativ UPT", "Exterioare": "Campus exterior",
}

# These four navigation symbols in this tour are a walking marker, doorway,
# arrow and circle. Menu text and aerial links also occur in adjacentPanoramas.
WALK_SYMBOLS = {
    "res_01BBDAC9_1300_B428_4194_3CFC70B77858_0.png": "walk",
    "res_01BCCAD4_1300_B438_418E_8056434D5E72_0.png": "door",
    "res_01B9FACB_1300_B428_4195_C3A76284874F_0.png": "walk",
    "res_058E34A7_15AC_8913_41A0_55D07AE4F408_0.png": "walk",
}


def extract(objects, strings):
    def resolve(value):
        return objects[value.removeprefix("this.")] if isinstance(value, str) else value

    playlist = [resolve(v) for v in objects["mainPlayList"]["items"]]
    entries = []
    for index, item in enumerate(playlist, start=1):
        pano = resolve(item["media"])
        if pano["class"] == "Panorama" and "drone" not in pano["data"].get("tags", []):
            entries.append((index, pano, resolve(item["camera"])))
    indices = {p["id"]: index for index, p, _ in entries}
    scenes = []
    for index, pano, camera in entries:
        data = pano["data"]
        name = strings.get(pano.get("label"), data.get("label", ""))
        group = next((v for k, v in AREA_NAMES.items() if k in data.get("tags", [])), "UPT")
        levels = pano["frames"][0]["cube"]["levels"]
        full_faces = [v for v in levels if v["colCount"] == 6 * v["rowCount"]]
        level = min(full_faces, key=lambda v: abs(v["height"] - 1024))
        position = camera.get("initialPosition", {})
        tile = level["url"]
        if "{face}" not in tile:
            raise ValueError(f"Unsupported panorama layout at checkpoint {index}")
        links = []
        for adjacent in pano.get("adjacentPanoramas", []):
            target = indices.get(adjacent["panorama"].removeprefix("this."))
            if target is None:
                continue
            overlay = objects[adjacent["data"]["overlayID"]]
            for ref in overlay.get("items", []):
                marker = resolve(ref)
                if "image" not in marker:
                    continue
                resource = resolve(marker["image"])
                if resource.get("class") != "AnimatedImageResource":
                    continue
                sprite = resolve(resource["levels"][0])["url"].rsplit("/", 1)[-1]
                if sprite in WALK_SYMBOLS:
                    links.append({
                        "to": target, "yaw": adjacent["yaw"], "pitch": marker["pitch"],
                        "back": adjacent.get("backwardYaw"), "kind": WALK_SYMBOLS[sprite],
                    })
                    break
        scenes.append({
            "index": index, "id": pano["id"], "label": name, "area": group,
            "view": [position.get("yaw", 0), position.get("pitch", 0)],
            "tile": tile, "grid": level["rowCount"], "thumb": pano["thumbnailUrl"], "links": links,
        })
    return scenes


# Map marker titles that differ from the panorama titles. Coordinates always
# come from the university's map placemarks, never its map viewport centers.
MAP_ALIASES = {
    "rectorat": "rectorat upt",
    "cel id ifr upt elearning center": "cel id ifr",
    "ccoc centrul de consiliere si orientare in cariera": "ccoc",
    "caminul 21c": "caminul studentesc c21", "caminul 9c": "caminul studentesc 9c",
}


def attach_pins(scenes, kml):
    ns = {"k": "http://www.opengis.net/kml/2.2"}
    names = {}
    for scene in scenes:
        names.setdefault(normalized(scene["label"]), []).append(scene)
    for pin in ElementTree.fromstring(kml).findall(".//k:Placemark", ns):
        title = pin.findtext("k:name", "", ns)
        point = pin.findtext("k:Point/k:coordinates", "", ns).strip()
        key = normalized(title).removeprefix("facultatea de ")
        matches = names.get(MAP_ALIASES.get(key, key), [])
        if len(matches) == 1 and point:
            lon, lat, *_ = map(float, point.split(","))
            if math.isfinite(lat) and math.isfinite(lon) and abs(lat) <= 90 and abs(lon) <= 180:
                matches[0]["pin"] = {"lat": lat, "lon": lon, "name": title}


def open_air(preview):
    """True when a panorama's equirectangular preview has sky or foliage overhead instead of a ceiling."""
    image = cv2.imdecode(np.frombuffer(preview, np.uint8), cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError("Unreadable panorama preview")
    rows = image.shape[0]
    # From about 86° down to 14° above the horizon.
    upper = cv2.cvtColor(image[rows // 50:rows * 21 // 50], cv2.COLOR_BGR2HSV).astype(int)
    hue, saturation, value = upper[..., 0], upper[..., 1], upper[..., 2]
    sky = (hue >= 95) & (hue <= 125) & (saturation >= 70) & (value >= 110)
    foliage = (hue >= 30) & (hue <= 90) & (saturation >= 60) & (value >= 40)
    overcast = (saturation <= 40) & (value >= 225)
    # A row near the zenith covers less of the sphere than a row near the horizon.
    weight = np.cos(np.radians(np.linspace(86, 14, upper.shape[0])))[:, None]
    share = ((sky | foliage | overcast) * weight).sum() / (weight.sum() * upper.shape[1])
    return bool(share >= 0.24)


def mark_open_air(scenes, version):
    """Flag outdoor panoramas. Ones already in the snapshot keep their flag without a download."""
    known = {}
    if SNAPSHOT.is_file():
        known = {s["id"]: s["open"] for s in json.loads(SNAPSHOT.read_bytes())["scenes"] if "open" in s}
    fresh = [s for s in scenes if s["id"] not in known]
    with ThreadPoolExecutor(6) as pool:
        flags = pool.map(lambda s: open_air(fetch(tour_url(f'{s["thumb"]}?v={version}'))), fresh)
        known.update((s["id"], flag) for s, flag in zip(fresh, flags))
    for scene in scenes:
        scene["open"] = known[scene["id"]]


def refresh():
    page = TourPage()
    page.feed(fetch(TOUR).decode())
    if not page.script or not page.locale:
        raise ValueError("The tour page no longer references the expected player and locale")
    player = fetch(tour_url(page.script)).decode()
    devices = json.loads(re.search(r"var devicesUrl\s*=\s*(\{[^;]+\});", player)[1])
    version = parse_qs(urlsplit(page.script).query)["v"][0]
    resource = devices["general"] + "?" + urlencode({"v": version})
    strings = dict(line.split(" = ", 1) for line in fetch(tour_url(page.locale)).decode().splitlines() if " = " in line)
    scenes = extract(definitions(fetch(tour_url(resource)).decode()), strings)
    map_embed = next(url for url in strings.values() if "www.google.com/maps/d/" in url and "mid=" in url)
    map_id = parse_qs(urlsplit(map_embed).query)["mid"][0]
    kml_url = "https://www.google.com/maps/d/kml?" + urlencode({"mid": map_id, "forcekml": 1})
    attach_pins(scenes, fetch(kml_url))
    mark_open_air(scenes, version)
    links = sum(len(s["links"]) for s in scenes)
    pins = sum("pin" in s for s in scenes)
    if not scenes or not links or not pins:
        raise ValueError("The tour format changed. Inspect the source before updating the index.")
    snapshot = {"source": TOUR, "revision": version, "map": map_embed, "scenes": scenes}
    SNAPSHOT.parent.mkdir(exist_ok=True)
    with tempfile.NamedTemporaryFile(mode="w", dir=SNAPSHOT.parent, delete=False, encoding="utf-8") as out:
        # One inspectable line per checkpoint keeps snapshot diffs local.
        header = json.dumps({k: v for k, v in snapshot.items() if k != "scenes"}, ensure_ascii=False)
        out.write(header[:-1] + ', "scenes": [\n')
        out.write(",\n".join(json.dumps(s, ensure_ascii=False) for s in scenes))
        out.write("\n]}\n")
    Path(out.name).replace(SNAPSHOT)
    outdoors = sum(s["open"] for s in scenes)
    print(f"Indexed {len(scenes)} ground checkpoints ({outdoors} outdoors), {links} directed links and {pins} building pins.")


if __name__ == "__main__":
    refresh()
