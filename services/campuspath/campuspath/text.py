"""Everything the planner writes for a student, in English and Romanian."""

LANGUAGES = ("en", "ro")

TEXT = {
    "ask.outside": ("That room or checkpoint is outside the index.",
                    "Sala sau punctul ales nu este în index."),
    "ask.start": ("Where are you starting? Choose a checkpoint you recognize.",
                  "De unde pornești? Alege un punct pe care îl recunoști."),
    "ask.destination": ("Which room or checkpoint do you want to reach?",
                        "La ce sală sau punct vrei să ajungi?"),
    "ask.several": ("Several places match. Choose the room or building you mean.",
                    "Se potrivesc mai multe locuri. Alege sala sau clădirea la care te referi."),
    "ask.unknown": ("“{query}” is not among the rooms and places of the virtual tour. "
                    "Check the room code, or search for the building instead.",
                    "„{query}” nu este printre sălile și locurile din turul virtual. "
                    "Verifică codul sălii sau caută clădirea."),
    "ask.length": ("Enter a route request of up to 1,000 characters.",
                   "Scrie o cerere de traseu de cel mult 1.000 de caractere."),
    "ask.start_room": ("Your starting room has no verified tour view. Choose a checkpoint you recognize.",
                       "Sala de plecare nu are o imagine verificată în tur. Alege un punct pe care îl recunoști."),
    "ask.disconnected": ("The tour has no connected ground route between these checkpoints. Choose another starting point.",
                         "Turul nu are un traseu la sol care să lege aceste puncte. Alege alt punct de plecare."),

    "checkpoint": ("Checkpoint {index}", "Punctul {index}"),
    "video.checkpoint": ("CHECKPOINT", "PUNCTUL"),

    "step.here": ("You are at your destination.", "Ești la destinație."),
    "step.arrive": ("Arrive at your destination.", "Ai ajuns la destinație."),
    "step.door": ("Go through the marked doorway toward {next}.", "Treci prin ușa marcată spre {next}."),
    "step.follow": ("Follow the marker toward {next}.", "Urmează marcajul spre {next}."),
    "step.ahead": ("Continue ahead toward {next}.", "Mergi înainte spre {next}."),
    "step.bear.left": ("Bear left toward {next}.", "Ține ușor stânga spre {next}."),
    "step.bear.right": ("Bear right toward {next}.", "Ține ușor dreapta spre {next}."),
    "step.turn.left": ("Turn left toward {next}.", "Fă stânga spre {next}."),
    "step.turn.right": ("Turn right toward {next}.", "Fă dreapta spre {next}."),
    "step.back": ("Turn around toward {next}.", "Întoarce-te spre {next}."),
    # The next checkpoint has no name worth reading out.
    "step.door.plain": ("Go through the marked doorway.", "Treci prin ușa marcată."),
    "step.follow.plain": ("Follow the marker.", "Urmează marcajul."),
    "step.ahead.plain": ("Continue ahead.", "Mergi înainte."),
    "step.bear.left.plain": ("Bear left.", "Ține ușor stânga."),
    "step.bear.right.plain": ("Bear right.", "Ține ușor dreapta."),
    "step.turn.left.plain": ("Turn left.", "Fă stânga."),
    "step.turn.right.plain": ("Turn right.", "Fă dreapta."),
    "step.back.plain": ("Turn around and keep going.", "Întoarce-te și mergi mai departe."),

    "notice.unmapped": ("This classroom is indexed. Its location has no verified tour checkpoint.",
                        "Sala este în catalog, dar locul ei nu are un punct verificat în tur."),
    "notice.start": ("The video starts at {place}, the closest the tour gets to your starting room.",
                     "Videoclipul începe la {place}, cel mai apropiat punct din tur de sala ta de plecare."),
    "notice.already": ("You are already at {place}.", "Ești deja la {place}."),
    "caption.start": ("Starting checkpoint for {room}", "Punct de plecare pentru {room}"),
    "your classroom": ("your classroom", "sala ta"),
    "the classroom": ("the classroom", "sala"),

    # A route that stops short of the room. {zone} is a floor with its preposition.
    "partial.beside": (", outside {room}", ", lângă {room}"),
    "partial.entrance.beyond": ("The tour does not show where {target} is in the building.",
                                "Turul nu arată unde este {target} în clădire."),
    "partial.entrance.caption": ("Tour ends at the entrance. It does not show where {short} is inside.",
                                 "Turul se termină la intrare. Nu arată unde este {short} în clădire."),
    "partial.checkpoint.beyond": ("The tour does not show the way from there to {target}.",
                                  "Turul nu arată drumul de acolo până la {target}."),
    "partial.checkpoint.caption": ("Tour ends here. It does not show the way to {short}.",
                                   "Turul se termină aici. Nu arată drumul până la {short}."),
    "partial.unseen.beyond": ("{target} is {zone}, which the tour does not show.",
                              "{target} este {zone}, unde turul nu ajunge."),
    "partial.unseen.caption": ("Tour ends here. {Short} is {zone}, beyond the tour.",
                               "Turul se termină aici. {Short} este {zone}, unde turul nu ajunge."),
    "partial.floor.beyond": ("{target} is on this floor. The tour does not show its door.",
                             "{target} este la acest etaj. Turul nu îi arată ușa."),
    "partial.floor.caption": ("Tour ends here, {zone}. Look for {short} on this floor.",
                              "Turul se termină aici, {zone}. Caută {short} la acest etaj."),
    "partial.away.beyond": ("{target} is {move}, {zone}, which the tour does not show.",
                            "{target} este {move}, {zone}, unde turul nu ajunge."),
    "partial.away.caption": ("Tour ends here. {Short} is {move}, {zone}.",
                             "Turul se termină aici. {Short} este {move}, {zone}."),
    # The last view faces the stairs that lead on.
    "partial.stairs.beyond": ("{target} is {move} by the stairs in the last view, {zone}.",
                              "{target} este {move} pe scările din ultima imagine, {zone}."),
    "partial.stairs.caption": ("Tour ends here. {Short} is {move} by these stairs, {zone}.",
                               "Turul se termină aici. {Short} este {move} pe aceste scări, {zone}."),
    # The last view faces the room's own door, read from its plate.
    "partial.door.beyond": ("The last view faces the door of {target}.", "Ultima imagine arată ușa sălii {target}."),
    "partial.doorhere.beyond": ("The view below faces its door.", "Imaginea de mai jos îi arată ușa."),
    "partial.door.caption": ("Tour ends here. The door ahead is {short}.",
                             "Turul se termină aici. Ușa din față este {short}."),
    "partial.doorhere.caption": ("Tour ends here. The door ahead is {short}.",
                                 "Turul se termină aici. Ușa din față este {short}."),
    "partial.waiting": ("You are already at {place}, the closest the tour gets to {target}, "
                        "so there is no walkthrough to show. {beyond}",
                        "Ești deja la {place}, cel mai apropiat punct din tur de {target}, "
                        "așa că nu există un traseu de arătat. {beyond}"),
    "partial.ends": ("The video ends at {place}. {beyond}", "Videoclipul se termină la {place}. {beyond}"),

    "render.ffmpeg": ("Install FFmpeg with the libx264 encoder to generate videos.",
                      "Instalează FFmpeg cu encoderul libx264 pentru a genera videoclipuri."),
    "render.cover": ("Could not save the walkthrough cover", "Coperta traseului video nu a putut fi salvată"),
    "render.encode": ("FFmpeg could not encode the walkthrough. ", "FFmpeg nu a putut coda traseul video. "),
    "render.download": ("A panorama could not be loaded from the UPT tour. Check the connection and try again.",
                        "O panoramă nu a putut fi încărcată din turul UPT. Verifică conexiunea și încearcă din nou."),
}

# A direction is a turn joined to what the way ahead is: "Turn left and take the stairs up to floor 2."
LEADS = {
    "step.bear.left": ("Bear left", "Ține ușor stânga"), "step.bear.right": ("Bear right", "Ține ușor dreapta"),
    "step.turn.left": ("Turn left", "Fă stânga"), "step.turn.right": ("Turn right", "Fă dreapta"),
    "step.back": ("Turn around", "Întoarce-te"),
}
WAYS = {
    "stairs_up": ("take the stairs up", "urcă pe scări"),
    "stairs_down": ("take the stairs down", "coboară pe scări"),
    "lift": ("take the lift", "ia liftul"),
    "corridor": ("follow the corridor", "mergi pe coridor"),
    "hall": ("cross the hall", "traversează holul"),
    "doorway": ("go through the doorway", "treci prin ușă"),
    "into_room": ("go in through the door", "intră pe ușă"),
    "out_of_room": ("leave the room", "ieși din sală"),
    "enter_building": ("go into the building", "intră în clădire"),
    "leave_building": ("leave the building", "ieși din clădire"),
}

FLOORS = {
    0: ("on the ground floor", "la parter"), "M": ("on the mezzanine", "la mezanin"),
    -1: ("in the basement", "la demisol"), "A": ("in the attic", "la mansardă"),
}


def language(value):
    """The requested language, or English for anything the planner does not write."""
    return value if value in LANGUAGES else "en"


def say(lang, key, **words):
    return TEXT[key][LANGUAGES.index(lang)].format(**words)


def floor_phrase(lang, floor, wing=""):
    """Where a floor is, ready to follow a verb: "on floor 4 of Corp B", "la etajul 4, în Corpul B"."""
    ro = lang == "ro"
    named = FLOORS.get(floor)
    phrase = named[LANGUAGES.index(lang)] if named else f"la etajul {floor}" if ro else f"on floor {floor}"
    return phrase + ((f", în Corpul {wing}" if ro else f" of Corp {wing}") if wing else "")


def floors_away(lang, gap):
    """How far a floor is from where the tour stops: "one floor up", "cu două etaje mai jos"."""
    count = abs(gap)
    if lang == "ro":
        floors = {1: "un etaj", 2: "două etaje"}.get(count, f"{count} etaje")
        return f"cu {floors} mai " + ("sus" if gap > 0 else "jos")
    return {1: "one floor", 2: "two floors"}.get(count, f"{count} floors") + (" up" if gap > 0 else " down")


def move(lang, turn, way, next_name=None, floor=None):
    """A direction for a link whose way ahead was checked in the pictures."""
    column = LANGUAGES.index(lang)
    act = WAYS[way][column]
    if floor is not None and way in ("stairs_up", "stairs_down", "lift"):
        # "on floor 2" and "la etajul 2" without their preposition.
        act += (" to " if lang == "en" else " până la ") + floor_phrase(lang, floor).split(" ", 1)[1]
    elif next_name:
        act += (" toward " if lang == "en" else " spre ") + next_name
    if turn in LEADS:
        return f'{LEADS[turn][column]} {"and" if lang == "en" else "și"} {act}.'
    return act[:1].upper() + act[1:] + "."
