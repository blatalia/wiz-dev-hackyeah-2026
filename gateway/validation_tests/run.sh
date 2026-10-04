#!/usr/bin/env bash
set +x
set -euo pipefail

validation_script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
validation_repo_root="$(cd -- "$validation_script_dir/../.." && pwd)"
validation_env_file="${1:-$validation_repo_root/gateway/.env}"
if (( $# > 0 )); then shift; fi

if [[ ! -f "$validation_env_file" ]]; then
    echo "Environment file not found. Usage: $0 [env-file] [suite arguments]" >&2
    exit 1
fi
# Resolve a supplied relative path before changing the working directory.
validation_env_file="$(cd -- "$(dirname -- "$validation_env_file")" && pwd)/$(basename -- "$validation_env_file")"
cd -- "$validation_repo_root"

if [[ -n "${VIRTUAL_ENV:-}" ]]; then
    validation_venv="$VIRTUAL_ENV"
elif [[ -f "$validation_repo_root/.venv/bin/activate" ]]; then
    validation_venv="$validation_repo_root/.venv"
elif [[ -f "$validation_repo_root/../.venv/bin/activate" ]]; then
    validation_venv="$validation_repo_root/../.venv"
else
    validation_venv="$validation_repo_root/.venv"
    python3 -m venv "$validation_venv"
fi
source "$validation_venv/bin/activate"
python -m pip install -r gateway/requirements.txt

set -a
source "$validation_env_file"
set +a

exec python -m gateway.validation_tests "$@"
