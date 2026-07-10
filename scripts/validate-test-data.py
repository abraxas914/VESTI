#!/usr/bin/env python3
"""Validate the VESTI test export and report its fitness for reflective-module testing.

This script is intentionally dependency-light: it only needs Python's stdlib.
It reads test_data/vesti-export-*.json and reports:
- conversation/message counts and platforms
- whether summaries exist (needed for full AITI/Learn signal)
- a sparse-data fixture plan (first 1, 2, 5, 10 conversations)
- sample inputs that can be pasted into unit tests
"""

import json
import sys
from pathlib import Path
from collections import Counter


def main():
    root = Path(__file__).resolve().parent.parent
    candidates = list(root.glob("test_data/vesti-export-*.json"))
    if not candidates:
        print("No test export found in test_data/", file=sys.stderr)
        sys.exit(1)

    # Pick the newest export by filename timestamp.
    export_path = sorted(candidates)[-1]
    print(f"Analyzing: {export_path.relative_to(root)}")

    with export_path.open("r", encoding="utf-8") as f:
        data = json.load(f)

    schema_version = data.get("schema_version")
    payload = data.get("data", {})
    conversations = payload.get("conversations", [])
    messages = payload.get("messages", [])
    summaries = payload.get("summaries", [])
    weekly_reports = payload.get("weeklyReports", [])
    annotations = payload.get("annotations", [])

    print(f"\nSchema version: {schema_version}")
    print(f"Conversations: {len(conversations)}")
    print(f"Messages: {len(messages)}")
    print(f"Summaries: {len(summaries)}")
    print(f"Weekly reports: {len(weekly_reports)}")
    print(f"Annotations: {len(annotations)}")

    if not conversations:
        print("\nNo conversations found — cannot test reflective modules.", file=sys.stderr)
        sys.exit(1)

    platforms = Counter(c.get("platform") for c in conversations)
    print(f"\nPlatforms: {dict(platforms)}")

    topic_ids = Counter(c.get("topic_id") for c in conversations)
    print(f"Topic distribution: {dict(topic_ids)}")

    msg_counts = Counter(len(messages) for messages in _group_messages(messages).values())
    print(f"\nMessage count per conversation: min={min(msg_counts)}, max={max(msg_counts)}")

    has_summaries = len(summaries) > 0
    print(f"\nHas summaries: {has_summaries}")
    if not has_summaries:
        print(
            "NOTE: This fixture has no summaries. AITI/Learn will exercise the "
            "messages-based fallback path. To test the full summary-based path, "
            "generate summaries first (e.g., via scripts/prepare-test-summaries.ts)."
        )

    # Sparse-data fixture plan.
    print("\n--- Sparse-data fixture plan ---")
    for n in (1, 2, 5, 10, len(conversations)):
        subset = conversations[:n]
        subset_ids = {c["id"] for c in subset}
        subset_msgs = [m for m in messages if m["conversation_id"] in subset_ids]
        print(
            f"  first {n:2d} conversations: {len(subset_msgs)} messages, "
            f"{len([c for c in subset if c.get('topic_id')])} with topic"
        )

    # Sanity checks.
    errors = []
    for m in messages:
        cid = m.get("conversation_id")
        if cid not in {c["id"] for c in conversations}:
            errors.append(f"orphan message conversation_id={cid}")
    for s in summaries:
        cid = s.get("conversationId")
        if cid not in {c["id"] for c in conversations}:
            errors.append(f"orphan summary conversationId={cid}")

    if errors:
        print(f"\nValidation errors ({len(errors)}):", file=sys.stderr)
        for e in errors[:10]:
            print(f"  - {e}", file=sys.stderr)
        sys.exit(1)

    print("\nValidation passed.")


def _group_messages(messages):
    grouped = {}
    for m in messages:
        grouped.setdefault(m["conversation_id"], []).append(m)
    return grouped


if __name__ == "__main__":
    main()
