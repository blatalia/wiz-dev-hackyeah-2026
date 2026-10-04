"""Run with python -m gateway.validation_tests from the repository root."""

import argparse

from .suite import exit_code, render_table, run_suite, summarize


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate guardrails directly using runtime credentials.")
    parser.add_argument("--local-only", action="store_true", help="Run SQL/tool-access cases; skip live-service cases.")
    args = parser.parse_args()
    print("Validating guardrail functions directly (no FastAPI).", flush=True)
    results = run_suite(local_only=args.local_only)
    print(render_table(results))
    print(summarize(results))
    return exit_code(results)


if __name__ == "__main__":
    raise SystemExit(main())
