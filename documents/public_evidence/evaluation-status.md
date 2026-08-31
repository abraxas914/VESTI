# Vesti Public Evaluation Status

Snapshot date: 2026-08-31  
Scope: public repository evidence only

## Current baseline

The checked-in file [`eval/reports/baseline.json`](../../eval/reports/baseline.json) is a **deterministic mock contract baseline**, generated on 2026-02-12.

| Item | Public baseline |
| --- | --- |
| Mode | `mock` / `mock_gold` |
| Total cases | 10 |
| Conversation cases | 7 |
| Weekly cases | 3 |
| Format compliance | 100% |
| Information coverage | 100% |
| Forbidden-fact / hallucination rate | 0% |
| Heuristic satisfaction score | 5 / 5 |

These values show that deterministic reference outputs satisfy the repository's required format and fact checks. They **do not measure live model quality**, production task success, real latency, cost, or user satisfaction.

The current repository contains a larger gold corpus than the frozen baseline. A local `--mode=mock --strict` verification on 2026-08-31 selected **30 cases** and passed the configured gate. That run remains deterministic Mock evaluation; it does not change the live-model evidence boundary described here.

The configured mock gates are:

- format compliance ≥ 98%
- information coverage ≥ 85%
- forbidden-fact / hallucination rate ≤ 8%
- heuristic satisfaction score ≥ 4.0 / 5

## Live workflow status

The scheduled workflow [`prompt-live-smoke-nightly.yml`](../../.github/workflows/prompt-live-smoke-nightly.yml) requires `VESTI_EVAL_API_KEY` and `VESTI_EVAL_MODEL_ID`.

The latest run inspected for this document—[2026-08-30, run 33301680779](https://github.com/abraxas914/VESTI/actions/runs/33301680779)—completed with the live-eval step **skipped because both required secrets were missing**. No `eval/reports/latest.json` or raw live report was uploaded.

Therefore the repository currently has **no verified public live-model benchmark**. A green scheduled workflow badge must not be interpreted as a successful live evaluation.

## Minimum evidence for a future live report

A publishable live report should record:

1. model provider, exact model/version, temperature, token limits, and evaluation timestamp;
2. dataset provenance, sample count, task distribution, redaction method, and train/test separation;
3. task success and structured-output compliance;
4. factual faithfulness and forbidden-fact rate;
5. fallback frequency and reason-code distribution;
6. P50/P95 end-to-end latency and per-task token/cost distribution;
7. representative bad cases, root-cause categories, and before/after regression results;
8. evaluator method, human-review protocol, and uncertainty or confidence bounds.

Until those conditions are met, product pages and recruiting materials should describe Vesti as having an **evaluation harness and mock regression gates**, not verified live-model performance.
