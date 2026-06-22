// Source of truth for the Lollapalooza 2026 set times (Grant Park, Chicago).
// Verbatim "NAME (Stage): start-end" lines per day, parsed into structured JSON.
// Re-run with `node data/build-lineup.mjs` to regenerate data/lineup-2026.json.
import { writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const DAYS = {
  "2026-07-30": `
5 SECONDS OF SUMMER (T-Mobile): 4:30pm-5:30pm
ASHA BANKS (T-Mobile): 12:45pm-1:30pm
AUDREY HOBERT (Allianz): 5:30pm-6:30pm
BAD NERVES (Allianz): 1:30pm-2:30pm
BELLA KAY (BMI): 4:30pm-5:10pm
BETWEEN FRIENDS (Bud Light): 2:45pm-3:45pm
BIXBY (Bud Light): 1pm-1:45pm
BLOOD ORANGE (Bud Light): 4:45pm-5:45pm
BORIS BREJCHA (Perry's): 5:45pm-6:45pm
BOYS NOIZE (Perry's): 4:15pm-5:15pm
CHALK (BMI): 5:40pm-6:20pm
CMAT (Airbnb): 6:30pm-7:15pm
DEVAULT (Tito's): 7:45pm-8:30pm
ECCA VANDAL (Airbnb): 2:50pm-3:30pm
ELIZABETH NICHOLS (BMI): 3:20pm-4pm
EMPIRE OF THE SUN (Bud Light): 6:45pm-7:45pm
EVENING ELEPHANTS (BMI): 6:50pm-7:30pm
FAOUZIA (Tito's): 12:15pm-1pm
HAUTE & FREDDY (T-Mobile): 2:30pm-3:30pm
JOHN SUMMIT (Bud Light): 8:30pm-10pm
KETTAMA (Perry's): 7pm-8pm
KIM THEORY (Airbnb): 12pm-12:30pm
KINGFISHR (Tito's): 1:45pm-2:45pm
KLO (Perry's): 12pm-12:30pm
KNOW GOOD (Perry's): 12:45pm-1:30pm
LITTLE SIMZ (Tito's): 5:45pm-6:45pm
LORDE (T-Mobile): 8:30pm-10pm
MARLON FUNAKI (Airbnb): 1:50pm-2:30pm
MPH (Perry's): 3pm-4pm
NINAJIRACHI (Airbnb): 4pm-4:45pm
PARIS PALOMA (Tito's): 3:45pm-4:45pm
PEARLY DROPS (Allianz): 12pm-12:45pm
PENELOPE ROAD (Airbnb): 12:50pm-1:30pm
SB19 (Allianz): 3:30pm-4:30pm
SIMON GROSSMANN (BMI): 2:10pm-2:50pm
SNOW STRIPPERS (Airbnb): 7:45pm-8:30pm
SOMBR (T-Mobile): 6:30pm-7:30pm
THE BRAYMORES (BMI): 1pm-1:40pm
VIAGRA BOYS (Airbnb): 9pm-10pm
WET LEG (Allianz): 7:30pm-8:30pm
WORSHIP (Perry's): 8:30pm-9:45pm
`,
  "2026-07-31": `
54 ULTRA (Airbnb): 2:50pm-3:30pm
AVELLO (Perry's): 12:45pm-1:30pm
BALU BRIGADA (Bud Light): 2:30pm-3:30pm
BENO (Airbnb): 12pm-12:30pm
BRADEAZY (Perry's): 12pm-12:30pm
CHARLI XCX (T-Mobile): 8:40pm-10pm
CHICAGO MADE (Tito's): 12:15pm-1pm
CLAIRE ROSINKRANZ (Allianz): 1:40pm-2:40pm
DAY WE RAN (Airbnb): 12:50pm-1:30pm
ELLA BOH (BMI): 2:10pm-2:50pm
ELLA RED (BMI): 5:40pm-6:20pm
EMI GRACE (BMI): 3:20pm-4pm
FINN WOLFHARD (Airbnb): 4pm-4:45pm
FREDDIE GIBBS (Airbnb): 9:15pm-10pm
HIGH VIS (Bud Light): 1pm-1:45pm
HORSEGIIRL (Airbnb): 8pm-8:45pm
I-DLE (T-Mobile): 2:40pm-3:40pm
IVRI (BMI): 4:30pm-5:10pm
JULIA WOLF (Tito's): 1:45pm-2:30pm
LIL UZI VERT (T-Mobile): 6:40pm-7:40pm
LOATHE (Tito's): 5:30pm-6:30pm
LOVE SPELLS (Airbnb): 1:50pm-2:30pm
LYNY (Perry's): 1:45pm-2:45pm
MAJOR LAZER (Perry's): 8:30pm-9:45pm
MOTHER MOTHER (Tito's): 3:30pm-4:30pm
MUSTARD (Perry's): 7pm-8pm
NETTSPEND (Tito's): 7:30pm-8:30pm
NOT FOR RADIO (Allianz): 7:40pm-8:40pm
NOTION (Perry's): 4:15pm-5:15pm
OKLOU (Airbnb): 5:30pm-6:15pm
PALOMA MORPHY (BMI): 6:50pm-7:30pm
PARTYOF2 (T-Mobile): 12:55pm-1:40pm
ROZ (Perry's): 3pm-4pm
SIDEPIECE (Perry's): 5:45pm-6:45pm
SKYE NEWMAN (Allianz): 3:40pm-4:40pm
SLAYYYTER (Airbnb): 6:45pm-7:30pm
THE ARMY, THE NAVY (Allianz): 12:10pm-12:55pm
THE SMASHING PUMPKINS (Bud Light): 8:30pm-10pm
THE STORY SO FAR (Bud Light): 4:30pm-5:30pm
VALENCIA GRACE (BMI): 1pm-1:40pm
WHITNEY WHITNEY (BMI): 12pm-12:30pm
YUNGBLUD (Bud Light): 6:30pm-7:30pm
ZARA LARSSON (T-Mobile): 4:40pm-5:40pm
SUKI WATERHOUSE (Allianz): 5:40pm-6:40pm
`,
  "2026-08-01": `
ALISON WONDERLAND (Perry's): 7pm-8pm
AYYBO (Perry's): 3pm-4pm
BBNO$ (Tito's): 6:15pm-7:15pm
CALDER ALLEN (BMI): 4:30pm-5:10pm
CAMERON WHITCOMB (Airbnb): 7:45pm-8:30pm
CHACE (Bud Light): 1:30pm-2:15pm
CHEZILE (Tito's): 12:45pm-1:30pm
CHICAGO YOUTH SYMPHONY ORCHESTRA (Tito's): 8:15pm-9pm
CLIPSE (Bud Light): 5:15pm-6:15pm
CORTIS (T-Mobile): 2:55pm-3:45pm
DIE SPITZ (Airbnb): 1:50pm-2:30pm
DISCO LINES (Perry's): 8:30pm-9:45pm
DJ TRIXIE MATTEL (Airbnb): 9pm-10pm
ETHEL CAIN (Bud Light): 7:15pm-8:15pm
FROST CHILDREN (Airbnb): 2:50pm-3:30pm
GEESE (Allianz): 7:30pm-8:30pm
GOLDIE BOUTILIER (Tito's): 2:15pm-3:15pm
INK (BMI): 3:20pm-4pm
JAE STEPHENS (BMI): 5:40pm-6:20pm
JENNIE (Bud Light): 9pm-10pm
JIM LEGXACY (Allianz): 1:55pm-2:55pm
KHAMARI (Allianz): 3:45pm-4:30pm
KWN (Airbnb): 6:30pm-7:15pm
LEON THOMAS (T-Mobile): 4:30pm-5:30pm
LUCY BEDROQUE (T-Mobile): 1:10pm-1:55pm
MAX STYLER (Perry's): 5:45pm-6:45pm
MC4D (Perry's): 12:45pm-1:30pm
MOMMA (Tito's): 4:15pm-5:15pm
NAT MYERS (Airbnb): 12pm-12:30pm
NEXT OF KIN (BMI): 2:10pm-2:50pm
OLIVIA DEAN (T-Mobile): 8:30pm-10pm
OMNOM (Perry's): 1:45pm-2:45pm
PEACE CONTROL (Perry's): 12pm-12:30pm
QUADECA (Airbnb): 4pm-4:45pm
RYMAN (BMI): 6:50pm-7:30pm
SIENNA SPIRO (Airbnb): 5:15pm-6pm
SPACEY JANE (Allianz): 5:30pm-6:30pm
SUNDAY (1994) (Allianz): 12:25pm-1:10pm
THE CREEKERS (BMI): 1pm-1:40pm
THE NEIGHBOURHOOD (T-Mobile): 6:30pm-7:30pm
VILLANELLE (Airbnb): 12:50pm-1:30pm
WHETHAN (Perry's): 4:15pm-5:15pm
WOLF ALICE (Bud Light): 3:15pm-4:15pm
`,
  "2026-08-02": `
ADELA (T-Mobile): 3pm-3:45pm
ADO (Airbnb): 9:15pm-10pm
AESPA (Allianz): 7:45pm-8:45pm
AFTER (Airbnb): 1:50pm-2:30pm
AMBER MARK (Allianz): 3:45pm-4:45pm
AMBLE (Airbnb): 5:15pm-6pm
BEABADOOBEE (T-Mobile): 6:45pm-7:45pm
CASE OATS (BMI): 3:20pm-4pm
CRUZ BECKHAM AND THE BREAKERS (Tito's): 2:15pm-3pm
DESTIN CONRAD (Allianz): 2pm-3pm
DOMBRESKY (Perry's): 4:15pm-5:15pm
DUKE DUMONT (Perry's): 5:45pm-6:45pm
EASY HONEY (Tito's): 12:45pm-1:30pm
ELI BROWN (Perry's): 7pm-8pm
FAKEMINK (Airbnb): 7:45pm-8:30pm
HOT MULLIGAN (Tito's): 6pm-7pm
INJI (Airbnb): 4pm-4:45pm
JACKIE HOLLANDER (Perry's): 12:45pm-1:30pm
JADE (Allianz): 5:45pm-6:45pm
JUSTINE SKYE (BMI): 4:30pm-5:10pm
LOS RETROS (Airbnb): 5:15pm-6pm
MONALEO (Airbnb): 6:30pm-7:15pm
MUNA (T-Mobile): 4:45pm-5:45pm
NEW CONSTELLATIONS (T-Mobile): 1:15pm-2pm
PORCH LIGHT (BMI): 5:40pm-6:20pm
RIORDAN (Perry's): 3pm-4pm
SNACKTIME (BMI): 1pm-1:40pm
STELLA LEFTY (Allianz): 12:30pm-1:15pm
SUNSHINE (Airbnb): 12pm-12:30pm
SURFING FOR DAISY (BMI): 2:10pm-2:50pm
TATE MCRAE (T-Mobile): 8:45pm-10pm
THE BENDS (Airbnb): 12:50pm-1:30pm
THE CHAINSMOKERS (Perry's): 8:30pm-9:45pm
THE XX (Bud Light): 8:45pm-10pm
TURNSTILE (Bud Light): 7pm-8pm
VANDELUX (Tito's): 8pm-8:45pm
WATER FROM YOUR EYES (Airbnb): 2:50pm-3:30pm
WAYLON WYATT (Bud Light): 3pm-4pm
WESTEND (Perry's): 1:45pm-2:45pm
WHATMORE (Bud Light): 1:30pm-2:15pm
WILL SWINTON (BMI): 6:50pm-7:30pm
WUNDERHORSE (Tito's): 4pm-5pm
YOASOBI (Bud Light): 5pm-6pm
ZACK MARTINO (Perry's): 12pm-12:30pm
`,
};

const DAY_LABELS = {
  "2026-07-30": "Thursday",
  "2026-07-31": "Friday",
  "2026-08-01": "Saturday",
  "2026-08-02": "Sunday",
};

// Lolla runs noon–10pm, so every time is PM. "12" stays 12, everything else +12.
function to24h(t) {
  const m = t.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (!m) throw new Error(`Unparseable time: "${t}"`);
  let h = parseInt(m[1], 10);
  const min = m[2] ? parseInt(m[2], 10) : 0;
  if (h !== 12) h += 12; // all afternoon/evening sets
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

const LINE = /^(.+?)\s*\(([^)]+)\):\s*(.+?)\s*-\s*(.+)$/;
const sets = [];
let id = 0;

for (const [date, block] of Object.entries(DAYS)) {
  for (const raw of block.trim().split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(LINE);
    if (!m) throw new Error(`Unparseable line: "${line}"`);
    const [, name, stage, start, end] = m;
    sets.push({
      id: `set-${id++}`,
      artist: name.trim(),
      stage: stage.trim(),
      date,
      day: DAY_LABELS[date],
      start: `${date}T${to24h(start)}`,
      end: `${date}T${to24h(end)}`,
    });
  }
}

const stages = [...new Set(sets.map((s) => s.stage))].sort();
const out = {
  festival: "Lollapalooza 2026",
  location: "Grant Park, Chicago, IL",
  dates: Object.keys(DAYS),
  stages,
  sets,
};

const dir = dirname(fileURLToPath(import.meta.url));
writeFileSync(join(dir, "lineup-2026.json"), JSON.stringify(out, null, 2));
console.log(`Wrote ${sets.length} sets across ${stages.length} stages: ${stages.join(", ")}`);
