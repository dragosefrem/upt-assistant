# Campuspath

Campuspath turns a student's destination request into a downloadable MP4 using the real panoramas and navigation hotspots in Universitatea Politehnica Timișoara’s virtual tour. The included B419 example starts at the Automatică și Calculatoare entrance, passes through 12 checkpoints and ends inside the fourth-floor lab. It is bundled in English and in Romanian. [Example video](examples/b419.mp4) · [Romanian example video](examples/b419-ro.mp4) · [Chapter list with tour links](examples/b419.json) · [UPT virtual tour](https://visit360.upt.ro/)

## Run locally

Use Python 3.11 or newer and FFmpeg with the `libx264` encoder on your PATH.

```sh
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
python app.py
```

Open the [route planner](http://127.0.0.1:8765). Choose a starting checkpoint and enter **I want to go to sala B419**, or give both places in one request such as **From the AC entrance to B419**. Romanian requests such as **Vreau să ajung la sala B419 de la intrarea AC** work too. Select any chapter to play that step, or use its arrow link to inspect the same view in the original tour.

The page opens in Romanian when the browser prefers Romanian to English, and the **RO / EN** switch in the header changes it at any time. The switch covers the interface, the directions and notices of the route in view, and the captions in its video. A walkthrough is rendered once per language. Requests are understood in either language whatever the switch says.

Under the video, **Next step** and **Previous step** play one checkpoint at a time and stop, with the direction for that checkpoint in text beside them. That is the way to follow a route while walking. The arrow keys do the same.

A route has an address. `/?from=355&to=B527` opens the walk from checkpoint 355 to room B527, and the address bar follows the route in view, so **Copy link** gives something to paste into a timetable or a message. `from` is a checkpoint number or a place name, `to` is whatever a student would type, `dest` pins a room when a code exists in two buildings, and `lang=ro` or `lang=en` sets the language for that visit. A link with only `from`, such as a QR code at an entrance, opens the page with that starting point chosen.

**QR code**, beside **Copy link**, shows the same address as a code for a phone to scan, and **Save image** gives it as a PNG to print or to put in a timetable. A code made while the app runs at `127.0.0.1` points to that computer alone, and the page says so. To try a code with a phone, start the app with `python app.py --host 0.0.0.0`, which lets every device on the network reach it, and open the page at the computer's network address.

Starting checkpoints can be found by name, panorama label, checkpoint number such as `#389`, or a shared UPT tour link. **Locate me** ranks 24 mapped campus buildings by distance on the student's device. The student confirms the starting view or selects an indoor checkpoint. The published coordinates identify buildings. They cannot determine an indoor room or floor. [University campus map](https://www.google.com/maps/d/viewer?mid=1yvUtg0vLH2AdUu7TabWd-8jX8f00UQI)

## Classroom directory

Open **Browse classrooms** to search by code, lab name, faculty or building. Each entry includes its university sources. A109, for example, has separate entries for Electro and ASPC. A room that the tour names differently from its timetable code is one entry: **D1**, **D001** and **AMF Alexandru Rogojan** all lead into the same amphitheatre. The November 2026 snapshot combines named tour rooms, departmental laboratory sheets, faculty teaching-space registers, floor plans and timetables. Some rooms appear only in older records. Campus-wide completeness still needs reconciliation against a current UPT register. [Browse the directory](http://127.0.0.1:8765/#classrooms) · [Room catalogue](data/classrooms.json) · [UPT laboratory directories](https://arhiva.upt.ro/Upt-Timisoara_laboratoare_273_ro.html)

| Coverage | What the student receives |
| --- | --- |
| `exact` | A route to the room's own panorama. |
| `checkpoint` | A route to the closest verified checkpoint: the room's own floor where the tour shows it, otherwise the nearest stairs or the building entrance. The last video caption states the floor and the remaining unverified walk. |
| `unmapped` | The classroom entry, available location and sources. |

Each entry also carries `reach`, which the page shows in the student's terms: `room` (video to the room), `door` (to its door), `floor` (to its floor), `near` (to a floor next to it), `checkpoint` (to a checkpoint a register named), `entrance` (to the building entrance) or `none`. A route to a room is titled with the room, such as **AC entrance → B527**, even when the video stops short. The page then marks it as a partial walkthrough and says where the video ends.

## How the route is generated

The importer follows the player and Romanian locale referenced by the tour page. It parses the published scene definitions as data, retains the direction, pitch and target of each recognized ground navigation hotspot, and maps each scene back to its one-based tour link. The supplied index contains **853 ground checkpoints and 1,998 directed links**. The importer filters aerial panoramas and menu shortcuts. It also reads each panorama's small preview and marks the checkpoints that stand outdoors, with sky or foliage overhead. With the corrections below, 183 do. [Tour player data](https://visit360.upt.ro/script_general.js)

The planner resolves room codes and place names to catalogue entries or checkpoints, then finds the connected route with the shortest estimated walk. A request that starts and ends at the same checkpoint is answered with a notice and that view. A walkthrough is rendered only when there is a walk between at least two checkpoints. It asks for a starting point or a choice between duplicate names when needed. An unknown room or a disconnected pair returns an explanation.

The tour publishes no distances between panoramas, so each hop counts as a typical length. The shortest walk is not always the fewest checkpoints: from the AC entrance to D1 the route crosses the main hall in nine checkpoints, because the eight-checkpoint alternative circles the building outdoors.

| Hop | Counted as | Basis |
| --- | --- | --- |
| Between indoor checkpoints | 8 m | The player draws indoor hotspots about 6 m away. |
| Between outdoor checkpoints | 40 m | Building pins on the campus map put outdoor panoramas 30 to 80 m apart, 60 m at the median. Their hotspots are drawn about 15 m away whatever the real gap. The planner counts the cautious end, so a short step across a courtyard is not traded for a long indoor detour. |
| Through a building's door | 22 m | One end outdoors. |

Among routes of equal length the planner takes the one whose hotspots are drawn nearer. These lengths are estimates. The planner cannot measure a corridor, does not count stairs, and does not know whether a door is locked. The imagery can also skip portions of corridors and stair flights.

For each checkpoint on the route, the renderer fetches the source cube tiles, projects a view toward the outgoing hotspot and draws a marker at its published bearing. When the incoming bearing is available, the camera turns from the arrival direction toward the next marker. A direction is built from the turn and from what the survey saw ahead: **Turn right and take the stairs up to floor 2**, **Take the lift to floor 1**, **Follow the corridor toward the display hall**, **Leave the building toward the Corp D entrance**. It names the next checkpoint only when that has a short name, and never reads out a bare checkpoint number. The B419 example also includes landmark directions checked against those views, in both languages. FFmpeg encodes the sequence as a 960 × 540 H.264 MP4, with three seconds per checkpoint.

The bundled example works immediately. New routes need internet access for uncached panoramas. Tile and video caches live under `.cache/`. Repeated requests for a route share a render, and only finished movies are served.

## Use the API

```sh
curl http://127.0.0.1:8765/api/routes \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"I want to go to sala B419","start":355}'
```

Add `"from": "AC entrance"` to name the starting place apart from the request. Send `"start": "auto"` to start at the mapped building entrance (a checkpoint with a map pin) from which the walk to the destination is shortest; the route then carries that entrance as `origin`, with its `pin`, and `"automatic": true`. A starting place named in the request or in `from` still wins. Add `"lang": "ro"` to receive the directions, notices, checkpoint names and video captions in Romanian. English is the default, and `lang` is echoed in the response. The response includes ordered `steps` with timestamps and source links, the video duration in seconds, and a `video` object. When the closest mapped checkpoint is the starting point itself, `steps` holds that one checkpoint, `duration` is 0, `video` is `null` and `notice` explains what is known about the room. For a queued or rendering movie, poll `GET /api/videos/<key>` until `state` is `ready`, then open its `url`. A failed render can be retried by resubmitting the request.

The `GET` endpoints below and `GET /api/example` take the same choice as `?lang=ro`.

`GET /api/classrooms?q=…&offset=0&limit=40` returns `total`, `asOf` and `items`. The optional `coverage` filter accepts the values above. To route to a selected classroom, pass its string `index` (for example, `room:electro-b419`) as `destination`. A known room with no mapped checkpoint returns its source record, an empty step list and `video: null`.

`GET /api/checkpoints?q=…` searches the tour. Add `rooms=1` to include classroom matches in a starting-point search. `GET /api/checkpoints?pins=1` returns building pins. A clarification returns HTTP 422 with a `field`, `message` and any matching `options`. Resubmit the selected classroom ID or numeric checkpoint as `start` or `destination` with the original prompt.

`GET /api/qr?link=…` returns a route's address as a QR code: an SVG, or a PNG with `format=png`.

```sh
curl -G http://127.0.0.1:8765/api/qr -o b527.png -d format=png \
  --data-urlencode 'link=http://127.0.0.1:8765/?from=355&to=B527'
```

The address must be a route of this app: the host the request came to, the home page or `/campus`, and no fields other than `from`, `to`, `dest` and `lang`. Anything else returns HTTP 400. Behind a proxy, pass the public host on in the `Host` header. An app that embeds the planner, such as Poli, opens routes at `https://<its host>/campus?from=…&to=…`.

## Floors, doors and what is ahead

On 21 November 2026 every building with catalogue rooms was surveyed from its panoramas: floor signs, door plates, and the stairs, lifts and corridors between checkpoints. Every door plate and stair view that a route relies on was checked a second time against the pictures. Floors and moves are used where the survey read them from a sign, a plate or a label, or from two pieces of evidence that agree. The survey gave 550 indoor checkpoints a floor, described 1,357 of the 1,998 moves between checkpoints, and found where a route to a room without a panorama should end.

| The route ends | When | Rooms |
| --- | --- | --- |
| Inside the room | The tour has a panorama of it. | 88 |
| Facing the room's door | Its plate was read from a corridor checkpoint. | 10 |
| On the room's floor | A checkpoint on that floor is known. | 233 |
| On a floor next to it | The tour does not show the room's floor. Where the stairs were found, the last view faces them. | 112 |
| At a checkpoint a register named | | 3 |
| At the building entrance | Nothing places the room. | 107 |
| Nowhere | The tour does not reach the building. | 81 |

In the Electro building the code gives the wing and floor: B413A is in Corp B on floor 4. Corp B has views of floors 0, 1, 3, 4 and 6, Corp A of the ground floor and floor 3, and Corp D of the ground floor and floor 1. The Corp B stairwell starts on the ground floor, where the back entrance opens from the street. Corp C has no panorama. A door plate reading "C 015" on the rear-exit landing places its ground floor there, so Corp C rooms end at that landing.

| Key in `data/classrooms.json` | Meaning |
| --- | --- |
| Site `zones` | Pattern for room codes that state the floor, with an optional wing. A wing is only matched with checkpoints in the same wing. |
| Site `anchors` | Checked checkpoint for a wing and floor, such as `B4`. Its `floor` is set when the checkpoint stands on a different floor from the rooms it serves. Its `look`, a yaw and pitch, turns the last view toward the stairs that lead on, and the caption then says **by these stairs**. |
| Site `floors` | Set for a building with a single stack of floors. Rooms then use their stated level. Without an anchor they borrow the checkpoint outside a photographed room on that floor. |
| Room `door` | The checkpoint from which the room's plate was read, with the yaw and pitch of the last view. |
| Room `near` | A corridor on the room's floor where the survey placed it without reading its plate. |

| Key in a `data/landmarks.json` note | Meaning |
| --- | --- |
| `floor` | The floor the checkpoint stands on: 0 is the ground floor and `"M"` a mezzanine. `null` withdraws a floor that the tour's own label states. |
| `ways` | What each move from this checkpoint is: `stairs_up`, `stairs_down`, `lift`, `corridor`, `hall`, `doorway`, `into_room`, `out_of_room`. |

The survey could not place everything. These rooms still end at their building entrance:

- Mecanică rooms with plain numbers such as 103 or 134. That older numbering states neither the building nor the floor.
- Hunedoara corps A, D and E. No sign or plate in the tour names them.
- Chimie rooms without an `A` code. Corp B numbers such as 8 B carry no floor, and no door shows a `C` code.
- The Rectorate's two rooms on "Etaj 2", because the building's floor numbering could not be read.
- Rooms listed with a name only and no level.

## Languages

Campuspath writes in English and Romanian. Room and lab names, building addresses and the tour's own place labels are shown as the university publishes them in both.

| Text | Where it lives |
| --- | --- |
| Directions, notices, questions and video captions | `campuspath/text.py`, one English and one Romanian form per sentence |
| Interface labels | `static/i18n.js` |
| Checked checkpoint names and landmark directions | The `ro` entry beside each note in `data/landmarks.json`. `mention` is the name as it reads inside a sentence: **the main hall**, **holul principal**. |
| Building names and source titles worded in English | The `ro` value beside them in `data/classrooms.json` |

An unnamed checkpoint is **Checkpoint 406** in English and **Punctul 406** in Romanian. A checked name or direction without a Romanian form falls back: the name is shown in English, and the direction is worked out from the hotspot's bearing. Checkpoints can be searched by either name.

## Import a classroom register

An institutional CSV can add classrooms, update names and attach verified tour views. Supply a `site` and at least one of `code` or `name` for every row. Use a site key from the catalogue, such as `electro`, or supply `site_name` for a new site. Optional columns are `faculty`, `level`, pipe-separated `aliases`, and either `panorama` for the exact room or `checkpoint` for a partial route. Both accept a ground-tour number, a stable scene ID or a shared tour link.

```sh
python -m campuspath.import_classrooms register.csv --source-title "UPT classroom register"
```

Add `--source-url` when the register has a shareable link. The importer merges room codes within each site, retains existing source references, and applies a validated file in one write. Restart the local server to load the updated directory.

## Refresh the tour

```sh
python -m campuspath.import_tour
python app.py --make-example
python -m unittest discover -s tests
```

Restart the server after refreshing. The index is replaced after a successful import, and `--make-example` rebuilds the bundled walkthrough in both languages. Panorama caches include the upstream revision, and video keys include the snapshot, landmark annotations, route and renderer version.

A refresh downloads a preview only for panoramas that are new to the index, to decide whether they stand outdoors. The check looks for sky or foliage overhead, so a panorama under an entrance canopy can read as indoors and a room with blue or green walls as outdoors. The tour also gives a few buildings on its menu, such as the library, a preview picture of the interior although the panorama stands outside. Correct a panorama by adding `"open": true` or `"open": false` under its scene ID in `data/landmarks.json`. Eleven panoramas carry such a note.
