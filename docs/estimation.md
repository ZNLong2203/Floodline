# How Floodline estimates depth

Every reported depth is a combination of **readings**. A reading is one estimator's interval for the
depth at the photo's location, with its source, so a coordinator can see where a number came from.

## The models' part

**Muse Spark 1.3** looks at the photo once (`floodline/perceive.py`). It returns, under a JSON
Schema that constrains decoding:

- up to 8 reference objects that stand in or beside the water (scooter, car, person, door, bicycle,
  bus, truck), each with a box on Spark's 0–1000 grid, which way it faces, whether its base is on
  the flooded ground, the part of it the water reaches (knee, seat, wheel hub…) and the share of its
  height under water;
- photo problems (blur, glare, a steep angle, an edited image), whether the water flows, the people
  it can see, its own depth range, and one Vietnamese sentence for the coordinator.

**SAM 3.1** runs twice per photo (`floodline/meta/sam.py`): once with the concept prompt
`flood water`, at the same time as Spark, and once with **Spark's boxes as box prompts**, returning
one mask per reference object under the id Floodline gave it.

**Muse Spark, again, close up** (`floodline/closeup.py`), in parallel with the second SAM call:
every object standing in the water is cropped with a margin, enlarged to at least 448 px, and all
crops go to Spark in one request with the question "where does the water reach on this one?".
In FloodDET street photos a wading person is often under 100 px tall; the close look is what lets
Spark tell a knee from a thigh.

## The arithmetic

All of it is plain code (`geometry.py`, `readings.py`, `estimate.py`, `passability.py`).

**Waterline.** For every column of an object's mask, take its lowest pixel; the column touches the
water when the water mask is within a small band of it. If fewer than 35% of columns touch, the
object isn't standing in the water (it's on a step, or hidden) and gives no geometric reading.
Otherwise the waterline is the median bottom row of the touching columns.

**Readings per object**, using `data/catalog.yaml` (sizes and landmark heights, each with sources):

| reading | depth | interval from |
|---|---|---|
| `scale` | full height − visible height × (known length or width ÷ its width in pixels) | height and size ranges of the class, ±4% width, ±2 px |
| `landmark` | height of the named part, e.g. a Vietnamese adult's knee 0.44–0.49 m | the catalog range |
| `fraction` | share submerged × full height | ±0.12 of the share |
| `closeup-landmark`, `closeup-fraction` | the same two from the close-up | the same |
| `spark` | Spark's own range for the whole photo | as given |

`scale` is only used for objects seen squarely from the side or front, fully visible above the
water and not cut off by the edge of the frame.

**Calibration** (`floodline/calibration.py`, fitted by `evals/calibrate.py` on 292 labelled
photos, 5-fold cross-validated). Every kind of reading ran high on labelled data, by 0.06 m
(close-up landmark) to 0.19 m (Spark's own range), and its interval was 1.7–4.8× too narrow. For
each kind, the median bias is subtracted and sigma is scaled so 90% of truths fall within 2 sigma:

```
kind               bias    sigma ×
landmark          +0.14 m    4.3
fraction          +0.18 m    1.8
scale             +0.11 m    3.3
spark (holistic)  +0.19 m    2.6
closeup-landmark  +0.06 m    4.8
closeup-fraction  +0.13 m    1.7
combined result              × 1.6   (readings from one photo share the model's errors)
```

**Combination.** Each interval becomes a normal (mean, sigma = width / 4). With three or more
readings, any further than 3 × 1.48 × MAD from the median is rejected and shown as rejected. The
rest are combined by inverse variance; when they disagree, the weighted spread replaces the formal
sigma, so disagreement widens the answer instead of being averaged away.

**Passability.** For each vehicle class in `data/catalog.yaml` (limits from AIDR/ARR, WRL 2014/07,
DEFRA FD2321, NWS, VicSES and the Đà Nẵng transport handbook; flowing-water limits when Spark
reports fast water), Floodline computes P(depth > limit) and says **passable** below 5%,
**impassable** above 60%, and **risky** in between, where a person should decide.

## Streets, not photos

`fusion.py` turns reports into a depth per OpenStreetMap street segment. A report affects segments
within 120 m; its sigma grows by 0.003 m per metre of distance (a street can rise or fall 0.3 m in a
block) and doubles every 3 hours (water moves). Fresh photos on the street dominate old ones nearby,
and several photos of one street narrow its interval. `roads.py` routes each vehicle class around
impassable segments and avoids risky ones when another way exists.

## Clips

`video.py` handles a 10–30 s clip filmed while walking past. It is re-encoded to 10 fps; Spark reads
the middle frame for reference objects; SAM 3.1 segments the water on every frame and tracks each
object from one box prompt on that frame, forward and back. Each object is measured on every frame
where it meets the water, and the 20th–80th percentile of those depths becomes one reading. Spark also
watches the whole clip, sound included, for its own range and anything said.
