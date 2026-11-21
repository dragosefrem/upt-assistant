import hashlib
import json
import logging
import re
import threading
from concurrent.futures import ThreadPoolExecutor

from .source import CACHE, ROOT
from .text import LANGUAGES, say
from .video import RENDER_VERSION, RenderError, render

# The bundled walkthrough in each language: b419.mp4, b419-ro.mp4 and their covers and chapter lists.
EXAMPLES = {lang: ROOT / "examples" / ("b419" if lang == "en" else "b419-" + lang) for lang in LANGUAGES}


def video_key(tour, route):
    path = ",".join(str(s["index"]) for s in route["steps"])
    identity = f"{RENDER_VERSION}/{tour.signature}/{path}"
    if route.get("lang", "en") != "en":
        identity += "/" + route["lang"]
    if route.get("coverage") == "checkpoint":
        last = route["steps"][-1]
        identity += f'/{route["destination"]["index"]}/{last["instruction"]}/{last["yaw"]}/{last["pitch"]}'
    for step in route["steps"]:
        if "caption" in step:
            identity += f'/{step["index"]}/{step["caption"]}'
    return hashlib.sha256(identity.encode()).hexdigest()[:24]


def make_example(tour):
    for lang, example in EXAMPLES.items():
        route = tour.example(lang)
        render(tour, route, example.with_suffix(".mp4"),
               lambda i, n: print(f"Rendering checkpoint {min(i+1,n)} of {n} ({lang})", flush=True),
               poster=example.with_suffix(".jpg"))
        manifest = {
            "key": video_key(tour, route), "source": tour.revision, "duration": route["duration"],
            "checkpoints": [
                {k: step[k] for k in ("index", "name", "time", "instruction", "url")}
                for step in route["steps"]
            ],
        }
        temporary = example.with_suffix(".json.tmp")
        temporary.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        temporary.replace(example.with_suffix(".json"))


class Videos:
    def __init__(self, tour):
        self.tour = tour
        self.lock = threading.Lock()
        self.workers = ThreadPoolExecutor(max_workers=1, thread_name_prefix="walkthrough")
        self.jobs = {}
        manifests = [example.with_suffix(".json") for example in EXAMPLES.values()]
        self.examples = {json.loads(manifest.read_text(encoding="utf-8"))["key"]: manifest
                         for manifest in manifests if manifest.is_file()}

    def file(self, key, extension):
        if not re.fullmatch(r"[0-9a-f]{24}", key):
            return None
        sample = self.examples[key].with_suffix(extension) if key in self.examples else None
        if sample and sample.is_file():
            return sample
        return CACHE / "videos" / (key + extension)

    def status(self, key):
        with self.lock:
            video = self.file(key, ".mp4")
            if video and video.is_file():
                return {"state": "ready", "key": key, "url": f"/media/{key}.mp4", "poster": f"/media/{key}.jpg"}
            return dict(self.jobs[key], key=key) if key in self.jobs else None

    def request(self, route):
        key = video_key(self.tour, route)
        with self.lock:
            cached = self.file(key, ".mp4").is_file()
            prior = self.jobs.get(key, {}).get("state")
            if not cached and prior not in ("queued", "rendering"):
                self.jobs[key] = {"state": "queued", "completed": 0, "total": len(route["steps"])}
                self.workers.submit(self._encode, key, route)
        return self.status(key)

    def _encode(self, key, route):
        def progress(done, total):
            with self.lock:
                self.jobs[key] = {"state": "rendering", "completed": done, "total": total}

        try:
            render(self.tour, route, self.file(key, ".mp4"), progress, self.file(key, ".jpg"))
            with self.lock:
                self.jobs.pop(key, None)
        except Exception as exc:
            logging.exception("Could not render walkthrough %s", key)
            lang = route.get("lang", "en")
            message = say(lang, exc.key) + exc.detail if isinstance(exc, RenderError) else say(lang, "render.download")
            with self.lock:
                self.jobs[key] = {"state": "error", "message": message}
