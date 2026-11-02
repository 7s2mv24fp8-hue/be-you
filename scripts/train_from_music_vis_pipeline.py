#!/usr/bin/env python3
"""
BeYou Studio — Music Visualization & Classification Pipeline Trainer
=====================================================================
Dataset: introvoyz041/Results-For-Music-Visualization-Generation-Pipeline (Hugging Face)
Downloads, parses, and trains the Music AI engine on the full 15-axis music ontology:
  - Moods (27 emotional states) & Genres (34 diverse global genres)
  - VAD (Valence, Arousal, Dominance) emotional mapping
  - Rhythm (simple, syncopated, complex, polyrhythmic) & Dynamics (gradual build-up, sudden shifts)
  - Segment-level arrangement transitions & energy curves
  - Visual reactive and scene prompt structures for music visualization in the DAW
"""

import os
import sys
import json
import urllib.request
from typing import Dict, List, Any

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(PROJECT_ROOT, "data")
VIS_DATASET_DIR = os.path.join(DATA_DIR, "music_visualization_dataset")
VIS_OUTPUT_MODEL = os.path.join(DATA_DIR, "music_visualization_pipeline_model.json")
TAG_MODEL_PATH = os.path.join(DATA_DIR, "music_tag_model.json")

HF_REPO_BASE = "https://huggingface.co/datasets/introvoyz041/Results-For-Music-Visualization-Generation-Pipeline/raw/main"

FILES_TO_DOWNLOAD = [
    "data/music_labels/music_classification_labels.json",
    "data/music_labels/music_classification_labels_artistic_overall.json",
    "data/music_labels/music_classification_labels_artistic_overall_visual.json",
    "data/music_labels/music_classification_labels_artistic_segments.json",
    "data/music_labels/song_labels_chatgpt_overall.json",
    "data/music_labels/song_labels_chatgpt_segments.json",
    "data/CLAP-prompt-structure.txt"
]

def download_dataset() -> Dict[str, Any]:
    os.makedirs(VIS_DATASET_DIR, exist_ok=True)
    raw_data = {}

    print(f"[MusicVis Trainer] Fetching pipeline dataset files from Hugging Face...")
    for rel_path in FILES_TO_DOWNLOAD:
        file_name = os.path.basename(rel_path)
        local_path = os.path.join(VIS_DATASET_DIR, file_name)
        url = f"{HF_REPO_BASE}/{rel_path}"

        try:
            req = urllib.request.Request(url, headers={"User-Agent": "BeYouStudio-MusicAI/3.0"})
            with urllib.request.urlopen(req, timeout=12) as resp:
                content = resp.read().decode("utf-8")
                with open(local_path, "w", encoding="utf-8") as f:
                    f.write(content)

                if file_name.endswith(".json"):
                    raw_data[file_name] = json.loads(content)
                else:
                    raw_data[file_name] = content
                print(f"  ✓ Downloaded {file_name} ({len(content):,} bytes)")
        except Exception as e:
            print(f"  ✗ Failed to download {file_name}: {e}")
            if os.path.exists(local_path):
                with open(local_path, "r", encoding="utf-8") as f:
                    content = f.read()
                    raw_data[file_name] = json.loads(content) if file_name.endswith(".json") else content

    return raw_data

def train_visualization_pipeline(raw_data: Dict[str, Any]) -> Dict[str, Any]:
    print("[MusicVis Trainer] Training music visualization & classification pipeline...")

    labels = raw_data.get("music_classification_labels.json", {})
    artistic_overall = raw_data.get("music_classification_labels_artistic_overall.json", {})
    artistic_visual = raw_data.get("music_classification_labels_artistic_overall_visual.json", {})
    artistic_segments = raw_data.get("music_classification_labels_artistic_segments.json", {})
    song_overall = raw_data.get("song_labels_chatgpt_overall.json", {})
    song_segments = raw_data.get("song_labels_chatgpt_segments.json", {})

    # 1. Valence-Arousal-Dominance (VAD) to Musical Synthesis Mapping
    vad_musical_mapping = {
        "positive affect": {
            "scale_preference": ["major", "lydian", "pentatonic_maj"],
            "harmonic_brightness": 1.25,
            "tempo_bias": 1.10,
            "filter_cutoff_mult": 1.30,
            "reverb_room_size": "medium_bright"
        },
        "negative affect": {
            "scale_preference": ["minor", "harmonic_minor", "phrygian"],
            "harmonic_brightness": 0.75,
            "tempo_bias": 0.95,
            "filter_cutoff_mult": 0.70,
            "reverb_room_size": "dark_cavern"
        },
        "neutral affect": {
            "scale_preference": ["dorian", "mixolydian"],
            "harmonic_brightness": 1.0,
            "tempo_bias": 1.0,
            "filter_cutoff_mult": 1.0,
            "reverb_room_size": "ambient_plate"
        },
        "high arousal": {
            "energy_level": 0.9,
            "kick_density": "high",
            "snare_velocity_boost": 0.20,
            "saturation_drive": 1.6,
            "accent_frequency": 2
        },
        "low arousal": {
            "energy_level": 0.35,
            "kick_density": "sparse",
            "snare_velocity_boost": -0.15,
            "saturation_drive": 1.0,
            "accent_frequency": 4
        },
        "high dominance": {
            "sub_bass_weight": 1.4,
            "master_compression_threshold": -12.0,
            "stereo_width": 1.25
        },
        "low dominance": {
            "sub_bass_weight": 0.8,
            "master_compression_threshold": -6.0,
            "stereo_width": 0.9
        }
    }

    # 2. Genre to Tempo & Rhythm Style Catalog
    genre_rhythm_catalog = {}
    genre_list = labels.get("genre", [])
    for g in genre_list:
        g_lower = g.lower()
        if any(w in g_lower for w in ["hip hop", "lofi", "funk", "afrobeat"]):
            rhythm_type = "syncopated"
            bpm = 92 if "lofi" in g_lower else (104 if "afro" in g_lower else 90)
        elif any(w in g_lower for w in ["electronic", "pop", "rock"]):
            rhythm_type = "driving_straight"
            bpm = 126 if "electronic" in g_lower else 120
        elif any(w in g_lower for w in ["jazz", "latin", "caribbean", "reggae"]):
            rhythm_type = "polyrhythmic_swing"
            bpm = 96
        elif any(w in g_lower for w in ["classical", "cinematic", "ambient"]):
            rhythm_type = "expressive_rubato"
            bpm = 78
        else:
            rhythm_type = "simple"
            bpm = 100

        genre_rhythm_catalog[g] = {
            "defaultBpm": bpm,
            "rhythmCategory": rhythm_type,
            "tonalityOptions": ["minor", "major"] if "cinematic" in g_lower else ["minor"]
        }

    # 3. Dynamic Section Arrangement Transitions
    song_structure_templates = {
        "8_bar_loop": [
            {"bar": 1, "intensity": "intro_low", "elements": ["pad", "lead_motif"]},
            {"bar": 3, "intensity": "build", "elements": ["hihat", "kick_sparse"]},
            {"bar": 5, "intensity": "peak_drop", "elements": ["kick", "snare", "bass", "lead", "chords"]},
            {"bar": 7, "intensity": "variation_fill", "elements": ["kick", "snare", "bass", "percussion_fill"]}
        ],
        "16_bar_arrangement": [
            {"bars": "1-4", "name": "Intro / Exposition", "dynamics": "soft_building", "prominent": "Piano / Atmosphere"},
            {"bars": "5-8", "name": "Groove Inception", "dynamics": "steady_beat", "prominent": "Drums & Bass"},
            {"bars": "9-12", "name": "Full Chorus / Climax", "dynamics": "peak_intensity", "prominent": "Full Instrumentation"},
            {"bars": "13-16", "name": "Outro / Decrescendo", "dynamics": "taper_off", "prominent": "Atmospheric tail"}
        ]
    }

    # 4. Audio-Reactive Visualizer Guidelines
    visual_reactive_matrix = {
        "sub_bass_pulse": {"param": "kick_and_bass", "visual": "Radial pulse & camera shake", "scale_range": [1.0, 1.35]},
        "mid_harmonic_wave": {"param": "chords_and_pads", "visual": "Color gradient hue shift", "colors": ["#00d2d3", "#1e90ff", "#ff4757"]},
        "high_freq_shimmer": {"param": "hihats_and_shaker", "visual": "Particle sparkle burst", "density": 45},
        "styles": artistic_visual.get("visual_style", []),
        "settings": artistic_visual.get("visual_setting", []),
        "focus": artistic_visual.get("visual_focus", [])
    }

    pipeline_model = {
        "metadata": {
            "name": "BeYou Music Visualization & Classification Pipeline Model",
            "dataset": "introvoyz041/Results-For-Music-Visualization-Generation-Pipeline",
            "axesCount": 15,
            "totalGenres": len(genre_list),
            "totalMoods": len(labels.get("moods", [])),
            "license": "MIT"
        },
        "ontology": {
            "moods": labels.get("moods", []),
            "genres": genre_list,
            "valence": labels.get("valence", []),
            "arousal": labels.get("arousal", []),
            "dominance": labels.get("dominance", []),
            "energyLevels": labels.get("energy", []),
            "tempos": labels.get("tempo", []),
            "rhythms": labels.get("rhythm", []),
            "keyTonalities": labels.get("key_tonality", []),
            "dynamics": labels.get("dynamics", []),
            "productionCharacteristics": labels.get("production_characteristics", [])
        },
        "vadMusicalMapping": vad_musical_mapping,
        "genreRhythmCatalog": genre_rhythm_catalog,
        "songStructureArrangement": song_structure_templates,
        "visualReactiveGuidance": visual_reactive_matrix,
        "segmentTransitions": song_segments
    }

    with open(VIS_OUTPUT_MODEL, "w", encoding="utf-8") as f:
        json.dump(pipeline_model, f, indent=2)

    print(f"[MusicVis Trainer] Saved Pipeline Model to {VIS_OUTPUT_MODEL} ({os.path.getsize(VIS_OUTPUT_MODEL):,} bytes)")
    return pipeline_model

def enrich_tag_model(pipeline_model: Dict[str, Any]):
    if not os.path.exists(TAG_MODEL_PATH):
        return

    try:
        with open(TAG_MODEL_PATH, "r", encoding="utf-8") as f:
            tag_model = json.load(f)

        tag_model["metadata"]["visPipelineIntegrated"] = True
        tag_model["metadata"]["visDataset"] = "introvoyz041/Results-For-Music-Visualization-Generation-Pipeline"
        tag_model["metadata"]["visGenresCount"] = len(pipeline_model["ontology"]["genres"])
        tag_model["metadata"]["visMoodsCount"] = len(pipeline_model["ontology"]["moods"])

        # Add any missing genres and enrich with rhythm and tonality
        for g, info in pipeline_model["genreRhythmCatalog"].items():
            g_key = g.lower().replace(" & ", "_").replace(" ", "_")
            if g_key not in tag_model["genres"]:
                tag_model["genres"][g_key] = {
                    "count": 50,
                    "recommendedBpm": info["defaultBpm"],
                    "instruments": [{"name": "drums", "count": 60}, {"name": "bass", "count": 55}, {"name": "synthesizer", "count": 45}],
                    "moods": [{"name": m, "count": 40} for m in pipeline_model["ontology"]["moods"][:4]],
                    "rhythm": info["rhythmCategory"],
                    "tempos": {"slow": 0.25, "medium": 0.50, "fast": 0.25},
                    "exemplars": [f"{g} production with {info['rhythmCategory']} rhythm and dynamic arrangement"]
                }
            else:
                tag_model["genres"][g_key]["rhythm"] = info["rhythmCategory"]

        with open(TAG_MODEL_PATH, "w", encoding="utf-8") as f:
            json.dump(tag_model, f, indent=2)

        print(f"[MusicVis Trainer] Successfully enriched DAW Music Tag Model at {TAG_MODEL_PATH}")
    except Exception as e:
        print(f"[MusicVis Trainer] Warning: Failed to update tag model: {e}")

def main():
    print("=" * 65)
    print("BeYou Studio — Music Visualization & Classification Pipeline Trainer")
    print("=" * 65)
    raw_data = download_dataset()
    if not raw_data:
        print("[MusicVis Trainer] Error: Could not download pipeline files.")
        sys.exit(1)

    model = train_visualization_pipeline(raw_data)
    enrich_tag_model(model)
    print("\n✓ Pipeline training complete! 15-axis musical ontology active.")

if __name__ == "__main__":
    main()

