#!/bin/bash
set -e
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
cd "$DIR"

echo "=========================================================="
echo " Launching FL Studio Clone — Standalone Desktop Edition"
echo " (Pro Audio Low-Latency Core Engine with Native Dialogs)"
echo "=========================================================="

./node_modules/.bin/electron . "$@"

