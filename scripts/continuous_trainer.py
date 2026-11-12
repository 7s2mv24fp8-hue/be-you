#!/usr/bin/env python3
"""
BeYou Studio — Continuous AI Producer and Co-Pilot Training Pipeline
====================================================================
Runs continuous pattern learning, feature extraction, dataset processing,
rhythm augmentation, and genre blending for specified duration (e.g. 3 hours).

Usage:
    python scripts/continuous_trainer.py --hours 3.0
"""

import os
import sys
import time
import argparse

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.abspath(os.path.join(SCRIPT_DIR, '..'))
sys.path.insert(0, PROJECT_ROOT)

from backend.continuous_trainer import _training_worker, GENRES

def main():
    parser = argparse.ArgumentParser(description="BeYou Studio Continuous AI Producer Training")
    parser.add_argument("--hours", type=float, default=3.0, help="Training duration in hours (default: 3.0)")
    args = parser.parse_args()

    duration_hours = args.hours

    print("=" * 65)
    print("BeYou Studio - Continuous AI Producer and Co-Pilot Training")
    print(f"Start Time: {time.strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"Target Duration: {duration_hours:.1f} hours ({duration_hours * 3600:.0f} seconds)")
    print("Settings: Temperature=1.20 | Top-p=0.90 | Repetition Penalty=1.35")
    print("=" * 65)

    # Launch continuous training worker loop
    _training_worker(duration_hours, GENRES)

if __name__ == '__main__':
    main()
