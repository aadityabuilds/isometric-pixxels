"""Turn Stanford's ALL-CAPS facility names into display names, complexes and categories."""

from __future__ import annotations

import re

ACRONYMS = {
    "EVGR", "SLAC", "CCRMA", "AOERC", "SEQ", "LKSC", "CCSR", "MSOB", "SIEPR", "GSB", "HSC", "PAMF",
    "SUL", "SAL", "CERAS", "CEMEX", "ANKO", "Y2E2", "BOB", "SHC", "LPCH", "LBRE", "ERC", "CIS", "ITS",
    "TA", "II", "III", "IV", "VI", "VII", "VIII", "IX", "XI", "XII", "SU", "EV", "RF", "MRI", "AIR",
    "HFD", "BMI", "CVRB", "SIM1", "ACSR", "PGA",
}
SMALL = {"of", "and", "the", "for", "at", "in", "on", "de", "la", "del", "a", "to"}

COMPLEXES = {
    "FLORENCE MOORE": "Florence Moore Hall",
    "LAGUNITA": "Lagunita Court",
    "STERN": "Stern Hall",
    "WILBUR": "Wilbur Hall",
    "CASPER": "Gerhard Casper Quad",
    "GOV'S CORNER": "Governor's Corner",
    "ESCONDIDO VILLAGE": "Escondido Village",
    "ESCONDIDO V HIGHRISE": "Escondido Village",
    "SCHWAB RES CTR": "Schwab Residential Center",
    "E.D. STONE": "Stanford Hospital (E.D. Stone)",
    "ARRILLAGA TENNIS CENTER": "Taube Tennis Center",
    "MUNGER GRADUATE RESIDENCE": "Munger Graduate Residences",
    "RICHARD LYMAN GRADUATE RES.": "Lyman Graduate Residences",
    "LIL GREEN RAINS": "Rains Houses",
    "RAINS": "Rains Houses",
    "MANZANITA PARK": "Manzanita Park",
    "STUDENT SERVICES CENTER": "Student Services Center",
}

RESIDENCE_COMPLEXES = {
    "Florence Moore Hall", "Lagunita Court", "Stern Hall", "Wilbur Hall", "Gerhard Casper Quad",
    "Governor's Corner", "Escondido Village", "Schwab Residential Center", "Munger Graduate Residences",
    "Lyman Graduate Residences", "Rains Houses", "Manzanita Park",
}
RESIDENCE_WORDS = [
    "RESIDENCE", " RES.", " APTS", "APARTMENT", " HOUSE", "TOWNHOUSE", "COTTAGE", "BRANNER", "TOYON",
    "ROBLE HALL", "CROTHERS", "MIRRIELEES", "KIMBALL", "SUITES", "THE ROW", "HOMETEL", "STUDIO",
    "EVGR", "KAPPA", "SIGMA", "ALPHA", "DELTA", "PHI ", "CHI ", "OMEGA", "THETA", "LAMBDA", "COOP",
    "CO-OP", "ROTH HOUSE", "HAMMARSKJ", "COLUMBAE", "SYNERGY", "XANADU", "WINDHOVER", "ENCHANTED",
    "NARNIA", "JERRY", "MARS", "PLUTO", "NEPTUNE", "URANUS", "SATURN", "JUPITER", "VENUS", "LANTANA",
    "CASTANO", "TOUSSAINT", "OKADA", "UJAMAA", "STORY", "STOREY", "DURAND", "GROVE", "MURRAY",
    "POTTER", "ROBINSON", "YOST", "EAST HOUSE", "KAIROS", "TERRA", "MUWEKMA", "BOB ", "SLAV",
]
SKIP_LABEL_WORDS = [
    "RESTROOM", "PUMP", "ELECTRICAL", "SUBSTATION", "TRANSFORMER", "STORAGE", "TRAILER", "MODULAR",
    "SHED", "ELEVATOR", "RF COTTAGE", "SWITCHBOARD", "KIOSK", "GAZEBO", "TRASH", "RECYCL", "VAULT",
    "GENERATOR", "CHILLER", "COOLING TOWER", "MECHANICAL ROOM", "UTILITY", "LOADING DOCK", "BOOTH",
    "WELL HOUSE", "ENCLOSURE", "TELECOM", "COMM. HUB", "FIRE PUMP", "TANK", "LAUNDRY",
]

LANDMARKS = {
    "HOOVER TOWER": 10,
    "MEMORIAL CHURCH": 10,
    "STANFORD STADIUM": 10,
    "GREEN LIBRARY - EAST WING": 8,
    "BING WING": 6,
    "CANTOR ARTS CENTER": 8,
    "BING CONCERT HALL": 8,
    "TRESIDDER MEMORIAL UNION": 7,
    "OLD UNION": 6,
    "FROST (LAURENCE) AMPHITHEATRE": 7,
    "MAPLES PAVILION": 7,
    "GATES COMPUTER SCIENCE": 6,
    "HUANG ENGINEERING CENTER": 6,
    "PACKARD ELECTRICAL ENGINEERING": 5,
    "ENCINA HALL": 6,
    "ANDERSON COLLECTION": 6,
    "HERBERT HOOVER MEMORIAL BLDG": 5,
    "LOU HENRY HOOVER BUILDING": 5,
    "KNIGHT MANAGEMENT CENTER": 6,
    "LAW SCHOOL - CROWN QUADRANGLE": 5,
    "ARRILLAGA FAMILY DINING COMMONS": 5,
    "STANFORD BOOKSTORE": 5,
    "CLOCK BELL TOWER": 5,
    "SUNKEN DIAMOND": 6,
    "AVERY AQUATIC CENTER": 5,
    "MAIN QUAD": 9,
}


def title_word(w: str, first: bool) -> str:
    bare = re.sub(r"[^A-Z0-9]", "", w.upper())
    if bare in ACRONYMS or (bare and not re.search(r"[AEIOUY]", bare) and len(bare) <= 4 and bare.isalpha()):
        return w.upper()
    lw = w.lower()
    if not first and lw in SMALL:
        return lw
    if lw.startswith("mc") and len(lw) > 3:
        return "Mc" + lw[2:].capitalize()
    if "'" in lw:
        head, _, tail = lw.partition("'")
        return head.capitalize() + "'" + (tail if len(tail) <= 2 else tail.capitalize())
    if "/" in lw and len(lw) > 1:
        return "/".join(title_word(p, True) for p in w.split("/"))
    if "-" in lw and len(lw) > 1:
        return "-".join(title_word(p, True) for p in w.split("-"))
    if lw.startswith("(") and len(lw) > 1:
        return "(" + title_word(w[1:], True)
    return lw.capitalize()


DISPLAY_OVERRIDES = {
    "GREEN LIBRARY - EAST WING": "Green Library",
    "BING WING": "Green Library Bing Wing",
    "FROST (LAURENCE) AMPHITHEATRE": "Frost Amphitheater",
    "HERBERT HOOVER MEMORIAL BLDG": "Herbert Hoover Memorial Building",
    "LAW SCHOOL - CROWN QUADRANGLE": "Stanford Law School",
    "ENVIRONMENT & ENERGY BUILDING(Y2E2)": "Y2E2",
    "ARRILLAGA CTR. FOR SPORTS AND REC.": "Arrillaga Center for Sports & Recreation",
    "SPILKER ENGINEERING & APPLIED SCI.": "Spilker Engineering & Applied Sciences",
    "HAAS CENTER FOR PUB SVC": "Haas Center for Public Service",
    "MEMORIAL CHURCH": "Memorial Church",
    "STANFORD STADIUM": "Stanford Stadium",
}


WORD_OVERRIDES = {"NG": "Ng House", "CASTANO": "Castaño", "HAMMARSKJOLD": "Hammarskjöld"}


def pretty(name: str) -> str:
    if name in DISPLAY_OVERRIDES:
        return DISPLAY_OVERRIDES[name]
    if name.strip() in WORD_OVERRIDES:
        return WORD_OVERRIDES[name.strip()]
    name = re.sub(r"\s+", " ", name.strip())
    name = re.sub(r"\bBLDG\b\.?", "Building", name)
    words = name.split(" ")
    out = " ".join(title_word(w, i == 0) for i, w in enumerate(words))
    out = out.replace("Bldg.", "Building").replace(" Bldg", " Building").replace("Ctr.", "Center")
    out = re.sub(r"\bSci\.", "Science", out)
    out = out.replace("Gov's Corner", "Governor's Corner")
    return out


def split_complex(raw: str):
    """'FLORENCE MOORE, ALONDRA' -> ('Florence Moore Hall', 'Alondra')."""
    if raw in DISPLAY_OVERRIDES:
        return None, DISPLAY_OVERRIDES[raw]
    for sep in (", ", " - ", "-"):
        if sep in raw:
            head, tail = raw.split(sep, 1)
            head = head.strip()
            if head in COMPLEXES:
                return COMPLEXES[head], pretty(tail)
    for prefix, group in COMPLEXES.items():
        if raw.startswith(prefix + " "):
            return group, pretty(raw[len(prefix) + 1 :])
    return None, pretty(raw)


def skip_label(raw: str) -> bool:
    return (
        raw in ("", "NA", "N/A")
        or any(w in raw for w in SKIP_LABEL_WORDS)
        or bool(re.search(r"[,-] (KITCHEN|ADMINISTRATIVE WING|ADMINISTRATION)$", raw))
    )


def categorize(raw: str, group: str | None, osm_tags: dict) -> str:
    u = raw.upper()
    b = osm_tags.get("building", "")
    if raw in LANDMARKS and LANDMARKS[raw] >= 8:
        return "landmark"
    if any(w in u for w in ("DINING", "CAFE", "KITCHEN", "COMMONS", "FACULTY CLUB", "TREEHOUSE")):
        return "dining"
    if "LIBRARY" in u or "ARCHIVE" in u:
        return "library"
    if any(w in u for w in ("GARAGE", "PARKING STRUCTURE", "PARKING")):
        return "parking"
    if any(w in u for w in (
        "STADIUM", " GYM", "GYMNASIUM", "AQUATIC", "POOL", "TENNIS", "SPORTS", "ATHLETIC", "BOATHOUSE",
        "MAPLES", "BURNHAM", "ARRILLAGA CTR", "FIELD HOUSE", "TRACK", "BASEBALL", "SOFTBALL", "GOLF",
        "VOLLEYBALL", "SUNKEN DIAMOND", "BALL ", "RECREATION", "AVERY", "DIVING", "WEIGHT ROOM",
    )):
        return "athletics"
    if any(w in u for w in (
        "HOSPITAL", "CLINIC", "MEDICAL", "MEDICINE", "NURSING", "PACKARD CHILDREN", "E.D. STONE",
        "DIAGNOSIS", "BLAKE WILBUR", "CANCER", "HEALTH", "PAVILION A", "PAVILION B", "LKSC", "ALWAY",
        "BECKMAN", "LOKEY", "CCSR", "FALK", "GRANT BUILDING", "LANE BUILDING", "EDWARDS BUILDING",
    )) or b == "hospital":
        return "medical"
    if any(w in u for w in (
        "MUSEUM", "ARTS", "ART GALLERY", "CONCERT", "MUSIC", "THEATER", "THEATRE", "AUDITORIUM",
        "AMPHITHEATRE", "ANDERSON COLLECTION", "CANTOR", "BRAUN", "DINKELSPIEL", "MCMURTRY", "BING WING",
        "MEMORIAL CHURCH", "CHAPEL",
    )):
        return "arts"
    if group in RESIDENCE_COMPLEXES:
        return "residence"
    if b in ("dormitory", "apartments", "residential", "house", "detached", "semidetached_house", "terrace"):
        return "residence"
    if any(w in u for w in RESIDENCE_WORDS):
        return "residence"
    return "academic"


MINOR_PATTERNS = [
    re.compile(r"^(I|II|III|IV|V|VI|VII|VIII)\s*-\s*UNIT", re.I),
    re.compile(r"^BUILDING \d+$", re.I),
    re.compile(r"^STUDIO \d+$", re.I),
    re.compile(r"^\d+ [A-Z' ]+ - RESIDENCE$", re.I),
    re.compile(r"LOUNGE$", re.I),
    re.compile(r"^GUEST COTTAGES", re.I),
    re.compile(r"ADMINISTRATION$", re.I),
]


def is_minor(display: str) -> bool:
    return any(p.search(display) for p in MINOR_PATTERNS)
