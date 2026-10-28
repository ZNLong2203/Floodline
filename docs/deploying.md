# Deploying

One container serves the API and the web app (`Dockerfile`). The public demo runs with
`FLOODLINE_MODEL_MODE=replay`: every answer comes from `data/cassettes/`, so it needs no API key and
costs nothing per visitor.

```bash
# 1. seed the demo store locally from the recorded answers (var/reports goes into the image)
FLOODLINE_MODEL_MODE=replay uv run floodline seed --city hue
FLOODLINE_MODEL_MODE=replay uv run floodline seed --city valencia

# 2. build with Cloud Build and deploy to Cloud Run
gcloud run deploy floodline --source . --region us-central1 \
  --memory 2Gi --cpu 2 --min-instances 1 --cpu-boost --max-instances 1 --timeout 3600 \
  --set-env-vars FLOODLINE_MODEL_MODE=replay
```

`--max-instances 1` keeps one store and one live-event stream; scenario reports keep the age they
have in the story, so the demo never goes stale. To analyse visitors' own photos, deploy with
`MODEL_API_KEY` from Secret Manager and `FLOODLINE_MODEL_MODE=live`, and set a spend limit on the
Meta Model API account first.
