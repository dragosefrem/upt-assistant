"""Merge an institutional CSV room register into the local, source-backed directory."""
import argparse
import csv
import fcntl
import hashlib
import json
import os
import re
import tempfile
from datetime import date
from pathlib import Path
from urllib.parse import urlsplit

from .classrooms import CATALOGUE, fold, tokens
from .routing import tour_reference
from .source import SNAPSHOT


def slug(text):
    return re.sub(r"[^a-z0-9]+", "-", fold(text)).strip("-")


def scene_id(value, by_index, by_id):
    if not value:
        return None
    if value in by_id:
        return value
    index = int(value) if value.isdecimal() else tour_reference(value)[0]
    if index not in by_index:
        raise ValueError(f"Unknown ground-tour panorama {value!r}")
    return by_index[index]


def merge_register(data, stream, title, url, scenes, as_of):
    if not title.strip():
        raise ValueError("Supply the name of the register")
    if url and (urlsplit(url).scheme not in ("http", "https") or not urlsplit(url).netloc):
        raise ValueError("Supply a web URL for the register or omit its URL")
    reader = csv.DictReader(stream)
    if not reader.fieldnames or "site" not in reader.fieldnames or not {"name", "code"}.intersection(reader.fieldnames):
        raise ValueError("The CSV needs site and at least one of code or name")
    by_index = {scene["index"]: scene["id"] for scene in scenes}
    by_id = set(by_index.values())
    existing = {r["id"]: r for r in data["rooms"]}
    by_code = {}
    for room in existing.values():
        for alias in room.get("aliases", []):
            key = tokens(alias)
            if len(key) == 1 and any(ch.isdigit() for ch in alias):
                lookup = (room["site"], tuple(key))
                if lookup in by_code and by_code[lookup] is not room:
                    by_code[lookup] = None
                else:
                    by_code[lookup] = room
    by_code.update({(r["site"], tuple(tokens(r["code"]))): r for r in existing.values() if r.get("code")})
    by_scene = {r["scene"]: r for r in existing.values() if r.get("scene")}
    ref = "register-" + hashlib.sha256((title + "\n" + (url or "")).encode()).hexdigest()[:14]
    data["sources"][ref] = {"title": title, "url": url}
    has_rows = False
    for line, raw in enumerate(reader, 2):
        has_rows = True
        if None in raw:
            raise ValueError(f"Line {line} has extra columns")
        row = {k: (v or "").strip() for k, v in raw.items()}
        site, code, name = row["site"], row.get("code"), row.get("name")
        if not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", site) or not (code or name):
            raise ValueError(f"Line {line} needs a site identifier and a room code or name")
        if site not in data["sites"]:
            if not row.get("site_name"):
                raise ValueError(f"Line {line} needs site_name for the new site {site!r}")
            data["sites"][site] = {"name": row["site_name"]}
        exact = scene_id(row.get("panorama"), by_index, by_id)
        anchor = scene_id(row.get("checkpoint"), by_index, by_id)
        if exact and anchor:
            raise ValueError(f"Line {line} specifies both an exact panorama and a partial route")
        rid = site + "-" + slug(code or name)
        room = by_code.get((site, tuple(tokens(code)))) if code else None
        room = room or existing.get(rid)
        mapped = by_scene.get(exact)
        if mapped and (mapped["site"] != site or room and mapped is not room):
            raise ValueError(f"Line {line} assigns an existing room panorama to another room")
        room = room or mapped
        if room is None:
            room = {"id": rid, "site": site, "name": name or code, "sources": []}
            data["rooms"].append(room)
            existing[rid] = room
        if exact:
            if room.get("scene") not in (None, exact):
                raise ValueError(f"Line {line} conflicts with the existing room panorama")
            room["scene"] = exact
            by_scene[exact] = room
        elif anchor:
            room["checkpoint"] = anchor
        aliases = [v.strip() for v in row.get("aliases", "").split("|") if v.strip()]
        if code:
            if room.get("code") and room["code"] != code:
                aliases.append(code)
            else:
                room["code"] = code
            by_code[site, tuple(tokens(code))] = room
        if name and name != room["name"]:
            aliases.append(room["name"])
            room["name"] = name
        if row.get("level"):
            room["level"] = row["level"]
        for key, values in (("faculties", [row.get("faculty")]), ("aliases", aliases), ("sources", [ref])):
            for value in values:
                if value and value not in room.get(key, []):
                    room.setdefault(key, []).append(value)
    if not has_rows:
        raise ValueError("The register has no classroom rows")
    data["rooms"].sort(key=lambda r: r["id"])
    data["asOf"] = as_of


def import_register(file, title, url=None, *, catalogue=CATALOGUE, as_of=None):
    scenes = json.loads(SNAPSHOT.read_text())["scenes"]
    lock = os.open(catalogue.parent, os.O_RDONLY)
    try:
        fcntl.flock(lock, fcntl.LOCK_EX)
        data = json.loads(catalogue.read_text(encoding="utf-8"))
        with file.open(encoding="utf-8-sig", newline="") as stream:
            merge_register(data, stream, title, url, scenes, as_of or date.today().isoformat())
        content = json.dumps(data, ensure_ascii=False, indent=2) + "\n"
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=catalogue.parent, delete=False) as tmp:
            try:
                tmp.write(content)
                tmp.flush()
                os.fsync(tmp.fileno())
                os.chmod(tmp.name, catalogue.stat().st_mode & 0o777)
                os.replace(tmp.name, catalogue)
            finally:
                Path(tmp.name).unlink(missing_ok=True)
        return len(data["rooms"])
    finally:
        os.close(lock)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("file", type=Path)
    parser.add_argument("--source-title", required=True)
    parser.add_argument("--source-url")
    args = parser.parse_args()
    try:
        count = import_register(args.file, args.source_title, args.source_url)
    except (ValueError, OSError, csv.Error) as error:
        parser.exit(1, f"{error}\n")
    print(f"{count} classroom records indexed.")
