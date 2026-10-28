"""Copy the chat-channel secrets from .env into Google Secret Manager (values never printed).

    uv run python scripts/push_secrets.py [--project floodline-hackathon]

Creates TELEGRAM_WEBHOOK_SECRET in .env if it is missing, then for each secret that
has a value: creates it if needed, adds a new version from stdin, and lets the Cloud
Run runtime service account read it.
"""

import argparse
import re
import secrets
import subprocess
from pathlib import Path

ENV = Path(__file__).resolve().parent.parent / ".env"
SECRETS = {
    "MODEL_API_KEY": "model-api-key",
    "TELEGRAM_BOT_TOKEN": "telegram-bot-token",
    "TELEGRAM_WEBHOOK_SECRET": "telegram-webhook-secret",
    "WHATSAPP_TOKEN": "whatsapp-token",
    "WHATSAPP_APP_SECRET": "whatsapp-app-secret",
    "WHATSAPP_VERIFY_TOKEN": "whatsapp-verify-token",
}


def read_env() -> dict[str, str]:
    values = {}
    for line in ENV.read_text().splitlines():
        key, sep, value = line.partition("=")
        if sep and not key.startswith("#"):
            values[key.strip()] = value.strip()
    return values


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--project", default="floodline-hackathon")
    args = ap.parse_args()

    text = ENV.read_text()
    if not re.search(r"^TELEGRAM_WEBHOOK_SECRET=\S", text, re.M):
        text = re.sub(r"^TELEGRAM_WEBHOOK_SECRET=.*\n?", "", text, flags=re.M).rstrip("\n")
        ENV.write_text(f"{text}\nTELEGRAM_WEBHOOK_SECRET={secrets.token_urlsafe(32)}\n")
        print("created TELEGRAM_WEBHOOK_SECRET in .env")

    number = subprocess.run(
        ["gcloud", "projects", "describe", args.project, "--format=value(projectNumber)"],
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()
    member = f"serviceAccount:{number}-compute@developer.gserviceaccount.com"
    values = read_env()
    for key, name in SECRETS.items():
        value = values.get(key, "")
        if not value:
            print(f"skip {name}: {key} is empty")
            continue
        p = ["--project", args.project]
        if subprocess.run(
            ["gcloud", "secrets", "describe", name, *p], capture_output=True
        ).returncode:
            subprocess.run(
                ["gcloud", "secrets", "create", name, *p, "--replication-policy=automatic"],
                check=True,
                capture_output=True,
            )
        subprocess.run(
            ["gcloud", "secrets", "versions", "add", name, *p, "--data-file=-"],
            input=value.encode(),
            check=True,
            capture_output=True,
        )
        subprocess.run(
            [
                "gcloud",
                "secrets",
                "add-iam-policy-binding",
                name,
                *p,
                f"--member={member}",
                "--role=roles/secretmanager.secretAccessor",
            ],
            check=True,
            capture_output=True,
        )
        print(f"ok {name}")


if __name__ == "__main__":
    main()
