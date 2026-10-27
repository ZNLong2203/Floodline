# Triage

Muse Spark reads what the resident wrote or said (Muse Voice Transcribe, Vietnamese) next to what
the photo showed, and extracts facts only: number of people, who is vulnerable, injury or medical
need, whether they are trapped, whether the water is rising, what they need, an address hint, a
one-line summary and a draft dispatch message. It is told never to invent people or needs.

The **priority is not the model's opinion**. It is this formula over those facts and the measured
depth (`floodline/triage.py`), so two coordinators always see the same order and can see why:

| fact | points |
|---|---|
| injury or medical need | +30 |
| vulnerable people (elderly, child, infant, pregnant, disabled, sick) | +10, +5 per kind (up to 3) |
| trapped | +15 |
| water rising | +10 |
| depth ≥ 1.0 m | +20 |
| depth ≥ 0.5 m | +10 |
| 5 or more people | +5 |

Capped at 100. Every card in the queue lists the reasons that made its score.
