import argparse

from flask import Flask, Response, abort, jsonify, request, send_file

from campuspath import share
from campuspath.jobs import Videos, make_example
from campuspath.routing import RouteQuestion, Tour
from campuspath.source import ROOT
from campuspath.text import language


def create_app(tour=None):
    app = Flask(__name__, static_folder=str(ROOT / "static"))
    app.config["MAX_CONTENT_LENGTH"] = 16 * 1024
    tour = tour or Tour()
    videos = Videos(tour)

    @app.get("/")
    def home():
        return app.send_static_file("index.html")

    def localized(records, lang):
        return [tour.localized(record, lang) for record in records]

    @app.get("/api/checkpoints")
    def checkpoints():
        lang = language(request.args.get("lang"))
        if request.args.get("pins") == "1":
            return jsonify(localized([r for r in tour.records.values() if "pin" in r], lang))
        query = request.args.get("q", "")[:1000]
        views = tour.search(query)
        if query.strip() and request.args.get("rooms") == "1":
            rooms = tour.classrooms.search(query)
            represented = {r["checkpoint"] for r in rooms if r["coverage"] == "exact"}
            views = rooms + [r for r in views if r["index"] not in represented]
        return jsonify(localized(views[:50], lang))

    @app.get("/api/classrooms")
    def classrooms():
        rooms = tour.classrooms.search(request.args.get("q", "")[:1000])
        coverage = request.args.get("coverage")
        if coverage:
            if coverage not in ("exact", "checkpoint", "unmapped"):
                return jsonify(message="Unknown coverage filter."), 400
            rooms = [room for room in rooms if room["coverage"] == coverage]
        offset = max(0, request.args.get("offset", 0, type=int))
        limit = min(100, max(1, request.args.get("limit", 40, type=int)))
        items = localized(rooms[offset:offset + limit], language(request.args.get("lang")))
        return jsonify(items=items, total=len(rooms), offset=offset, asOf=tour.classrooms.as_of, limit=limit)

    @app.get("/api/example")
    def example():
        route = tour.example(language(request.args.get("lang")))
        return jsonify(**route, video=videos.request(route))

    @app.post("/api/routes")
    def routes():
        data = request.get_json(silent=True)
        if not isinstance(data, dict):
            return jsonify(message="Send a JSON object with a route request."), 400
        lang = language(data.get("lang"))
        try:
            route = tour.plan(data.get("prompt", ""), data.get("start"), data.get("destination"), lang, data.get("from"))
        except RouteQuestion as question:
            # "key" says which question it is ("ask.unknown", "ask.several"), whatever the language.
            return jsonify(message=question.text(lang), field=question.field, key=question.key,
                           options=localized(question.options, lang), needsChoice=question.choose), 422
        # A walkthrough needs somewhere to walk: one checkpoint is answered with its notice alone.
        return jsonify(**route, video=videos.request(route) if len(route["steps"]) > 1 else None)

    @app.get("/api/qr")
    def qr():
        kind = request.args.get("format", "svg")
        if kind not in ("svg", "png"):
            return jsonify(message="Unknown format. Use svg or png."), 400
        try:
            link = share.route_link(request.args.get("link"), request.host)
        except ValueError as problem:
            return jsonify(message=str(problem)), 400
        picture = Response(share.png(link), mimetype="image/png") if kind == "png" else Response(
            share.svg(link), mimetype="image/svg+xml")
        # The code depends on the address alone.
        picture.cache_control.max_age = 86400
        return picture

    @app.get("/api/videos/<key>")
    def status(key):
        state = videos.status(key)
        return jsonify(state) if state else (jsonify(message="Walkthrough not found."), 404)

    @app.get("/media/<key>.<extension>")
    def media(key, extension):
        if extension not in ("mp4", "jpg"):
            abort(404)
        path = videos.file(key, "." + extension)
        if path is None or not path.is_file():
            abort(404)
        return send_file(path, conditional=True, max_age=86400)

    return app


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="UPT campus route assistant")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--make-example", action="store_true", help="Rebuild the example MP4 and its chapter list")
    args = parser.parse_args()
    if args.make_example:
        make_example(Tour())
    else:
        create_app().run(host=args.host, port=args.port, threaded=True)
