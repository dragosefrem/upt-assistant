"""Render real cube panoramas and their authored navigation bearings to H.264."""

import math
import os
import shutil
import subprocess
import tempfile
from concurrent.futures import ThreadPoolExecutor
from functools import lru_cache
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

from .routing import SECONDS_PER_STOP
from .source import CACHE, fetch, tour_url
from .text import say

WIDTH, HEIGHT, FPS = 960, 540, 20
EQUATOR = 3072
FOV = 84
FACES = "frblud"
RENDER_VERSION = "2"
cv2.setNumThreads(2)


class RenderError(RuntimeError):
    """A failure the student can be told about, in their language."""

    def __init__(self, key, detail=""):
        super().__init__(say("en", key) + detail)
        self.key = key
        self.detail = detail


def load_tile(path, url):
    def decode(data):
        image = cv2.imdecode(np.frombuffer(data, dtype=np.uint8), cv2.IMREAD_COLOR)
        if image is None or image.shape[0] != image.shape[1]:
            raise ValueError("Expected a square panorama face")
        return image

    if path.is_file():
        try:
            return decode(path.read_bytes())
        except (cv2.error, ValueError):
            pass
    data = fetch(url)
    pixels = decode(data)
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as tmp:
        tmp.write(data)
    os.replace(tmp.name, path)
    return pixels


def cube_face(scene, revision, face):
    grid = scene.get("grid", 1)
    directory = CACHE / "panoramas" / revision / scene["id"] / str(grid)
    rows = []
    for row in range(grid):
        tiles = []
        for column in range(grid):
            asset = scene["tile"].format(face=face, row=row, column=column)
            path = directory / f"{face}-{row}-{column}.jpg"
            tiles.append(load_tile(path, tour_url(asset + "?v=" + revision)))
        rows.append(np.concatenate(tiles, axis=1))
    return np.concatenate(rows, axis=0)


@lru_cache(maxsize=2)
def cube_lookup(size):
    """Map an equirectangular image to the six faces of a horizontal cube strip."""
    lon = ((np.arange(EQUATOR, dtype=np.float32) + 0.5) / EQUATOR - 0.5) * (2 * np.pi)
    lat = (0.5 - (np.arange(EQUATOR // 2, dtype=np.float32)[:, None] + 0.5) / (EQUATOR // 2)) * np.pi
    x = np.cos(lat) * np.sin(lon)
    z = np.cos(lat) * np.cos(lon)
    y = np.broadcast_to(np.sin(lat), x.shape)
    major = np.maximum(np.maximum(abs(x), abs(y)), abs(z))
    u, v = np.empty_like(x), np.empty_like(x)
    for i, (normal, right, down) in enumerate((
        (z, x, -y), (x, -z, -y), (-z, -x, -y), (-x, z, -y), (y, x, z), (-y, x, -z),
    )):
        mask = normal == major
        u[mask] = np.clip((right[mask] / major[mask] + 1) * (size / 2) - 0.5, 0, size-1) + i * size
        v[mask] = np.clip((down[mask] / major[mask] + 1) * (size / 2) - 0.5, 0, size-1)
    return cv2.convertMaps(u, v, cv2.CV_16SC2)


def panorama(scene, revision, pool):
    faces = list(pool.map(lambda f: cube_face(scene, revision, f), FACES))
    strip = np.concatenate(faces, axis=1)
    return cv2.remap(strip, *cube_lookup(faces[0].shape[0]), interpolation=cv2.INTER_LINEAR)


def projection(pitch, fov=FOV):
    """Pixel rays for the rectilinear camera. Yaw is an offset in the panorama."""
    focal = WIDTH / (2 * math.tan(math.radians(fov / 2)))
    x = (np.arange(WIDTH, dtype=np.float32) + 0.5 - WIDTH/2) / focal
    up = (HEIGHT/2 - np.arange(HEIGHT, dtype=np.float32)[:, None] - 0.5) / focal
    angle = math.radians(pitch)
    y = up * math.cos(angle) + math.sin(angle)
    z = math.cos(angle) - up * math.sin(angle)
    lon = np.arctan2(x, z)
    lat = np.arctan2(y, np.hypot(x, z))
    return (lon / (2*np.pi) + 0.5) * EQUATOR - 0.5, (0.5 - lat / np.pi) * (EQUATOR//2) - 0.5


def view(pano, maps, yaw):
    return cv2.remap(pano, maps[0] + yaw * (EQUATOR/360), maps[1], cv2.INTER_LINEAR, borderMode=cv2.BORDER_WRAP)


def camera_pitch(step):
    if step["kind"] == "arrival":
        return step["pitch"]
    # Keep both the landmark and the floor hotspot in view.
    return step["pitch"] + max(-8, min(12, -step["pitch"] * 0.6))


def draw_marker(frame, step, yaw, pitch, phase):
    delta = math.radians(step["yaw"] - yaw)
    elevation, tilt = math.radians(step["pitch"]), math.radians(pitch)
    x = math.sin(delta) * math.cos(elevation)
    z = math.cos(delta) * math.cos(elevation)
    y = math.sin(elevation)
    depth = z * math.cos(tilt) + y * math.sin(tilt)
    if depth <= 0.1:
        return
    focal = WIDTH / (2 * math.tan(math.radians(FOV / 2)))
    cx = round(WIDTH / 2 + focal * x / depth)
    cy = round(HEIGHT / 2 - focal * (y * math.cos(tilt) - z * math.sin(tilt)) / depth)
    if not (-35 < cx < WIDTH + 35 and -35 < cy < HEIGHT + 35):
        return
    radius = 23 + round(2 * math.sin(phase * 4 * math.pi))
    cv2.circle(frame, (cx, cy), radius + 1, (27, 40, 28), -1, cv2.LINE_AA)
    cv2.circle(frame, (cx, cy), radius, (133, 243, 208), 3, cv2.LINE_AA)
    points = np.int32([[cx-9, cy+4], [cx, cy-5], [cx+9, cy+4]])
    cv2.polylines(frame, [points], False, (180, 255, 229), 4, cv2.LINE_AA)


@lru_cache(maxsize=16)
def font(size, bold=False):
    filenames = [
        "DejaVuSans-Bold.ttf" if bold else "DejaVuSans.ttf",
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf" if bold else "/System/Library/Fonts/Supplemental/Arial.ttf",
        "arialbd.ttf" if bold else "arial.ttf",
    ]
    for filename in filenames:
        try:
            return ImageFont.truetype(filename, size=size)
        except OSError:
            continue
    return ImageFont.load_default(size=size)


def fit_text(draw, text, y, size, bold=False, fill="white"):
    face = font(size, bold)
    while size > 12 and draw.textlength(text, font=face) > WIDTH - 64:
        size -= 1
        face = font(size, bold)
    draw.text((30, y), text, font=face, fill=fill, anchor="lm")


def caption(step, i, total, lang="en"):
    layer = Image.new("RGBA", (WIDTH, HEIGHT))
    draw = ImageDraw.Draw(layer)
    for y in range(HEIGHT-130, HEIGHT):
        alpha = round(226 * ((y - HEIGHT + 130) / 130) ** 0.65)
        draw.line((0, y, WIDTH, y), fill=(11, 23, 23, alpha))
    counter = f'{say(lang, "video.checkpoint")}   {i+1:02} / {total:02}'
    draw.rounded_rectangle((24, 22, 71 + round(draw.textlength(counter, font=font(14, True))), 55),
                           radius=16, fill=(15, 33, 29, 220))
    draw.ellipse((38, 35, 45, 42), fill="#d0f385")
    draw.text((55, 39), counter, font=font(14, True), anchor="lm")
    draw.text((WIDTH-26, 39), "visit360.upt.ro", font=font(15), anchor="rm", fill="white",
              stroke_width=1, stroke_fill=(15, 33, 29, 170))
    fit_text(draw, step.get("caption", step["name"]), HEIGHT-69, 31, bold=True)
    fit_text(draw, step["instruction"], HEIGHT-33, 20, fill="#edf4e8")
    return layer


def render(tour, route, output, progress, poster=None):
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise RenderError("render.ffmpeg")
    output = Path(output)
    output.parent.mkdir(parents=True, exist_ok=True)
    steps = route["steps"]
    with tempfile.TemporaryDirectory(dir=output.parent) as work, tempfile.TemporaryFile() as log:
        partial = Path(work) / "video.mp4"
        args = [ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-f", "rawvideo",
                "-pix_fmt", "rgb24", "-s", f"{WIDTH}x{HEIGHT}", "-r", str(FPS), "-i", "pipe:0",
                "-an", "-c:v", "libx264", "-threads", "3", "-preset", "veryfast", "-crf", "22",
                "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(partial)]
        process = subprocess.Popen(args, stdin=subprocess.PIPE, stderr=log)
        try:
            with ThreadPoolExecutor(max_workers=4) as downloads:
                for i, step in enumerate(steps):
                    progress(i, len(steps))
                    pano = panorama(tour.scenes[step["index"]], tour.revision, downloads)
                    pitch = camera_pitch(step)
                    maps = projection(pitch)
                    if poster and i == 0:
                        cover = view(pano, projection(pitch + 5, 110), step["yaw"])
                        if not cv2.imwrite(str(Path(work) / "poster.jpg"), cover):
                            raise RenderError("render.cover")
                    overlay = caption(step, i, len(steps), route.get("lang", "en"))
                    alpha = overlay.getchannel("A")
                    end = step["yaw"]
                    start = step["arrivalYaw"] if step["arrivalYaw"] is not None else end
                    turn = (end - start + 180) % 360 - 180
                    frames = SECONDS_PER_STOP * FPS
                    for j in range(frames):
                        phase = j / (frames - 1)
                        t = min(1, phase / 0.62)
                        yaw = start + turn * t*t*(3 - 2*t)
                        frame = view(pano, maps, yaw)
                        if step["kind"] != "arrival":
                            draw_marker(frame, step, yaw, pitch, phase)
                        image = Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
                        image.paste(overlay, mask=alpha)
                        process.stdin.write(image.tobytes())
            process.stdin.close()
            if process.wait() != 0:
                raise BrokenPipeError
        except BrokenPipeError as exc:
            process.wait()
            log.seek(0)
            raise RenderError("render.encode", log.read(600).decode(errors="replace")) from exc
        finally:
            if process.poll() is None:
                process.kill()
                process.wait()
            if not process.stdin.closed:
                process.stdin.close()
        if poster:
            Path(poster).parent.mkdir(parents=True, exist_ok=True)
            os.replace(Path(work) / "poster.jpg", poster)
        os.replace(partial, output)
        progress(len(steps), len(steps))
