# Architecture

```
 resident's phone                          Floodline server                                coordinator
 ───────────────                           ────────────────                                ───────────
 photo + location ──► POST /api/reports ──► normalise (EXIF, 1600 px)
 (+ voice note)                              │
                                             ├─► Muse Spark 1.3 ─────────┐   in parallel
                                             │   objects, boxes 0–1000,  │
                                             │   facing, waterline part, │
                                             │   photo quality           │
                                             ├─► SAM 3.1 "flood water" ──┤
                                             │                           ▼
                                             ├─► SAM 3.1 box prompts from Spark's boxes
                                             │      one mask per reference object
                                             ▼
                                         geometry.py   waterline row on every mask
                                         readings.py   pixels → metres (catalog sizes),
                                                       landmark → metres, fraction → metres
                                         estimate.py   MAD outlier rejection, inverse-variance
                                                       mean, disagreement kept in sigma
                                         passability   P(depth > limit) per vehicle
                                             │
                     voice note ──► Muse Voice Transcribe (Vietnamese)
                                             │
                                         triage.py    Spark extracts facts → fixed score
                                             ▼
                                         store (var/reports/<id>/)
                                             │
                                         fusion.py    reports → street segments within 120 m,
                                                      widened by distance and age
                                         roads.py     OSM graph of central Huế, routing per
                                                      vehicle around impassable segments
                                             │
                                 GET /api/segments, /api/route, SSE /api/events ──► web console
```

## Modules

| Module | What it does | Model calls |
|---|---|---|
| `floodline/perceive.py` | Asks Muse Spark for reference objects with boxes on the 0–1000 grid, orientation, the body or vehicle part the water reaches, the share submerged, photo quality flags, people and a Vietnamese summary. Constrained by JSON Schema. | 1 × `muse-spark-1.3` |
| `floodline/meta/sam.py` | Builds box prompts from Spark's boxes and parses SAM's token output into full-frame masks with `meta-sam-parser`. | 2 × `sam-3.1` (water, objects) |
| `floodline/geometry.py` | Finds the row where each object's mask meets the water mask. Rejects objects whose base is not touching water. | none |
| `floodline/readings.py` | Turns one object's evidence into depth intervals using `data/catalog.yaml`. | none |
| `floodline/estimate.py` | Combines intervals into one depth with a sigma. | none |
| `floodline/passability.py` | Probability that depth exceeds each vehicle's limit, then passable / risky / impassable. | none |
| `floodline/triage.py` | Spark reads the resident's words beside the photo facts; a published formula orders the queue. | 1 × `muse-spark-1.3` |
| `floodline/voice.py` | ffmpeg to 24 kHz mono WAV, then Muse Voice Transcribe with a Vietnamese language bias. | 1 × `muse-voice-transcribe-1.0` |
| `floodline/fusion.py` | Depth per street segment from nearby reports. | none |
| `floodline/roads.py` | Street graph, snapping and routing. | none |
| `floodline/meta/client.py` | Every API call, with record / replay cassettes. | — |

## Why the models don't do the arithmetic

Spark is good at recognising a scooter and saying the water is at its seat. It is not a measuring
instrument, and its numbers can't be audited. So Spark names things and points at them, SAM draws
their exact outline, and plain code measures. Every depth Floodline reports can be traced to a
reading, every reading to an object on the overlay, and every size to a source in the catalog.

## Running without a key

`FLOODLINE_MODEL_MODE=replay` answers every model call from `data/cassettes/`, recorded with
`FLOODLINE_MODEL_MODE=record`. The demo scenario and the tests run this way.
