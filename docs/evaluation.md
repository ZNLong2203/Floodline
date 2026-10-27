# Evaluation

How well does Floodline read depth from a photo, and how often would it have sent a vehicle into
water deeper than its limit? Measured on photos whose depth was labelled by people, not by us.

## Data

**FloodDET** (Singha, IIT Guwahati, Mendeley Data, CC BY 4.0, doi:10.17632/px48m7vwvf). 10,262
flood photos with persons, bicycles, cars and buses labelled at 11 submersion levels. FloodDET does
not define the levels; they follow its source, DeepFlood (Chaudhary et al. 2020, Table 2), which
turns each level into a depth range using a 170 cm person (level 4 = 21–42 cm, level 7 = 85–106 cm).
We score against the middle of that range.

We drew a stratified sample of 300 labelled objects (100 persons, 100 cars, 50 bicycles, 50 buses,
spread over levels); 292 are in photos with a flood region. Details and the exact sample:
`data/datasets/README.md`, `data/datasets/eval_manifest.jsonl` (the images are not redistributed).

**Caveats, stated plainly**
- The photos are not from Vietnam (mostly Europe, the US and India).
- Depth labels are human judgements on a person-height scale, then applied to vehicles too. Persons
  are the cleanest labels; bus labels are the noisiest.
- The sample is 292 photos. Differences of 0.01 m are noise.

## Method

`evals/run.py` runs the full pipeline once per photo (every model answer is recorded, so the
numbers below can be reproduced without an API key) and stores every raw reading. It matches the
labelled object to the object Floodline found (box IoU ≥ 0.3; 271 of 292 matched) and scores:

- **object level**: each kind of reading on the labelled object alone;
- **photo level**: Spark's own whole-photo range ("Spark only", the baseline), and Floodline's
  photo estimate from every object.

`evals/calibrate.py` then fits the calibration (a bias and an interval scale per kind of reading)
with **5-fold cross-validation grouped by photo**: each photo is scored by a calibration fitted on
the other four folds. Every calibrated number below is out of fold.

## Results

### Depth (photo level, 292 photos)

| | MAE | interval contains truth | mean interval width |
|---|---|---|---|
| Spark alone, raw | 0.277 m | 52% | 0.36 m |
| Floodline, raw | 0.228 m | 67% | 0.51 m |
| Spark alone, calibrated (out of fold) | 0.220 m | 93% | — |
| **Floodline, calibrated (out of fold)** | **0.199 m** | **95%** | 0.82 m |

Raw, Floodline's error is 18% below Spark answering alone. Calibrated, it is 10% lower at the same
coverage. The raw intervals were overconfident (true depth inside only 52–67% of the time);
calibrated, they hold the truth 95% of the time. They are wide, about ±0.4 m, and that is the honest
width of a single photo. Several reports on one street narrow it (see `floodline/fusion.py`).

### Each kind of reading (object level, out of fold)

| reading | what it is | n | MAE | coverage |
|---|---|---|---|---|
| landmark | Spark: "the water is at the knee" → catalog height of a knee | 230 | 0.182 m | 93% |
| close-up landmark | the same, from an enlarged crop of the object | 226 | 0.211 m | 94% |
| close-up fraction | share of the object under water, from the crop | 248 | 0.208 m | 93% |
| fraction | share under water, from the whole photo | 249 | 0.225 m | 92% |
| Spark holistic | Spark's own range for the photo | 290 | 0.220 m | 93% |
| geometry | waterline on the SAM 3.1 mask × known object size | 67 | 0.407 m | 94% |

Per class (calibrated, photo level): persons 0.166 m, cars 0.160 m, bicycles 0.223 m, buses 0.323 m.

Adding the close-up look lowered the raw photo MAE from 0.257 to 0.228 m and the calibrated one from
0.211 to 0.199 m. Single-photo geometry is the weakest reading: in street photos the reference
objects are small, oblique and often partly hidden, so few qualify and pixel errors are large. It is
kept because the calibration weights it accordingly, and because in a clip SAM 3.1 tracks the same
object across hundreds of frames, which is where geometry becomes useful (see below).

### Decisions (out of fold, 257 photos where the label doesn't straddle the limit)

A route is shown **passable** only when P(depth > limit) < 5%, **impassable** when > 60%, and
**risky** (a person should look) in between.

| vehicle (limit, still water) | passable | risky | impassable | right when decided | **passable but over the limit** |
|---|---|---|---|---|---|
| on foot (0.50 m) | 101 | 62 | 94 | 94% | 3 |
| scooter (0.21 m) | 49 | 52 | 156 | 94% | 3 |
| car (0.30 m) | 67 | 61 | 129 | 94% | 2 |
| SUV / pickup (0.40 m) | 78 | 64 | 115 | 95% | 5 |
| rescue truck (0.50 m) | 101 | 62 | 94 | 94% | 3 |

Without calibration, the same pipeline marked 25 photos impassable for cars that were in fact below
the limit; calibrated, 9. The 5% threshold was chosen on these results (it halved the unsafe
"passable" calls against 10%), so it is tuned, not held out.

## Clips

Two clips from Quảng Ngãi (Wikimedia Commons, CC BY-SA 4.0), 28 s each, 277 frames at 10 fps. SAM
3.1 tracked every reference object from one box prompt on the middle frame; in clip 03 a scooter was
measured on 113 frames with a median of 0.40 m (20th–80th percentile 0.36–0.43 m), where Spark,
watching the whole clip, said "water at the knee", 0.3–0.5 m. We have no labelled clips, so this is
a demonstration, not a measurement.

## Reproduce

```bash
FLOODLINE_MODEL_MODE=replay uv run python -m evals.run data/datasets/eval_manifest.jsonl --flooded-only
uv run python -m evals.calibrate evals/runs/<run>/rows.jsonl
```

The first needs the FloodDET images (`data/datasets/README.md`); the recorded model answers are in
`data/cassettes/`. Full output: `evals/reports/calibration.json`.
