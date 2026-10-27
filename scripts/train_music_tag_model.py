#!/usr/bin/env python3
"""
BeYou Studio — Music Tag & Prompt Model Generator
==================================================
Trained on: wanghappy/Music-tag-generation (53,053 Qwen-Audio 2.0 captions)
Combines: MTG-Jamendo (34,896) + Magnatune (18,157)

Generates:
  - data/music_tag_model.json: compact in-DAW probabilistic music tag graph
"""

import json
import re
import os
from collections import Counter, defaultdict

# Known musical taxonomies for normalization
CANONICAL_GENRES = [
    'electronic', 'synthwave', 'techno', 'house', 'ambient', 'trance', 'drum and bass', 'dubstep',
    'hip-hop', 'trap', 'lo-fi', 'boom bap',
    'rock', 'metal', 'punk', 'alternative rock', 'indie rock',
    'pop', 'synthpop', 'indie pop',
    'jazz', 'blues', 'funk', 'soul',
    'classical', 'orchestral', 'cinematic',
    'folk', 'acoustic', 'country',
    'reggae', 'dub',
    'experimental', 'noise', 'soundtrack', 'world'
]

CANONICAL_INSTRUMENTS = [
    'synthesizer', 'synth', 'drum machine', 'drums', 'acoustic drums', 'electric guitar',
    'acoustic guitar', 'bass', 'electric bass', 'sub bass', '808', 'piano', 'electric piano',
    'strings', 'violin', 'viola', 'cello', 'double bass', 'harp',
    'trumpet', 'saxophone', 'flute', 'clarinet', 'brass',
    'human voice', 'vocals', 'choir', 'organ', 'percussion', 'congas', 'bongos',
    'sound effects', 'foley', 'turntables', 'bells'
]

CANONICAL_MOODS = [
    'energetic', 'lively', 'upbeat', 'exciting', 'groovy',
    'calm', 'peaceful', 'soothing', 'gentle', 'serene', 'relaxed', 'mellow',
    'dark', 'ominous', 'menacing', 'eerie', 'gloomy',
    'sad', 'melancholic', 'somber', 'contemplative', 'nostalgic', 'reflective',
    'aggressive', 'angry', 'intense', 'manic', 'fierce',
    'happy', 'playful', 'cheerful', 'uplifting',
    'passionate', 'dramatic', 'romantic', 'dreamy', 'mysterious'
]

def clean_genre(raw):
    raw = raw.strip().lower()
    raw = re.sub(r'^(the\s+|a\s+|an\s+)', '', raw)
    raw = re.sub(r'\s+music(\s+piece)?$', '', raw)
    if 'hip' in raw or 'rap' in raw:
        return 'hip-hop'
    if 'synth' in raw and 'wave' in raw:
        return 'synthwave'
    if 'electro' in raw or 'techno' in raw or 'edm' in raw:
        return 'electronic'
    for cg in CANONICAL_GENRES:
        if cg in raw:
            return cg
    return raw[:30]

def extract_features(caption):
    lower = caption.lower()

    # Genre extraction
    genre = None
    gm = re.search(r'genre (?:of (?:the )?music piece )?is ([^,\.]+)', lower)
    if gm:
        genre = clean_genre(gm.group(1))

    # Tempo extraction
    tempo = 'medium'
    if re.search(r'\bfast\b|\buptempo\b|\bquick\b|\brapid\b', lower):
        tempo = 'fast'
    elif re.search(r'\bslow\b|\bdowntempo\b|\blaid-back\b|\bcalm\b', lower):
        tempo = 'slow'

    # Instrument extraction
    instruments = []
    for inst in CANONICAL_INSTRUMENTS:
        pattern = r'\b' + re.escape(inst) + r'(?:s)?\b'
        if re.search(pattern, lower):
            # Normalize
            norm = inst
            if inst in ('synth', 'synthesizers'): norm = 'synthesizer'
            elif inst == 'acoustic drums': norm = 'drums'
            elif inst in ('electric bass', 'sub bass'): norm = 'bass'
            elif inst == 'vocals': norm = 'human voice'
            if norm not in instruments:
                instruments.append(norm)

    # Mood extraction
    moods = []
    for m in CANONICAL_MOODS:
        if re.search(r'\b' + re.escape(m) + r'\b', lower):
            if m not in moods:
                moods.append(m)

    return genre, tempo, instruments, moods

def train():
    files = ['data/MTG-Qwen.json', 'data/MAG-Qwen.json']
    all_data = []
    for fpath in files:
        if os.path.exists(fpath):
            print(f"Loading {fpath}...")
            with open(fpath, 'r', encoding='utf-8') as f:
                all_data.extend(json.load(f))
        else:
            print(f"Warning: {fpath} not found")

    print(f"Total dataset records: {len(all_data)}")

    genre_counts = Counter()
    tempo_counts = Counter()
    instrument_counts = Counter()
    mood_counts = Counter()

    genre_instruments = defaultdict(Counter)
    genre_moods = defaultdict(Counter)
    genre_tempos = defaultdict(Counter)
    mood_instruments = defaultdict(Counter)
    instrument_cooccur = defaultdict(Counter)

    genre_exemplars = defaultdict(list)

    for item in all_data:
        cap = item.get('caption', '')
        if not cap:
            continue

        genre, tempo, insts, moods = extract_features(cap)

        if genre:
            genre_counts[genre] += 1
            genre_tempos[genre][tempo] += 1

            for inst in insts:
                genre_instruments[genre][inst] += 1
                instrument_counts[inst] += 1

            for m in moods:
                genre_moods[genre][m] += 1
                mood_counts[m] += 1

            # Save best exemplars per genre
            if len(genre_exemplars[genre]) < 6 and 40 < len(cap) < 180:
                genre_exemplars[genre].append(cap)

        for m in moods:
            for inst in insts:
                mood_instruments[m][inst] += 1

        # Pairwise instrument co-occurrence
        for i in range(len(insts)):
            for j in range(i + 1, len(insts)):
                instrument_cooccur[insts[i]][insts[j]] += 1
                instrument_cooccur[insts[j]][insts[i]] += 1

        tempo_counts[tempo] += 1

    # Filter to top genres (at least 15 mentions)
    top_genres = {g: count for g, count in genre_counts.items() if count >= 15}

    # Format model
    model = {
        "metadata": {
            "name": "BeYou Music Tag & Prompt Model",
            "dataset": "wanghappy/Music-tag-generation (Qwen-Audio 2.0)",
            "trainedSamples": len(all_data),
            "generatedAt": "2026-10-28",
            "totalGenres": len(top_genres),
            "totalInstruments": len(instrument_counts),
            "totalMoods": len(mood_counts)
        },
        "genres": {},
        "moods": {},
        "instruments": {},
        "instrumentCooccurrence": {}
    }

    # BPM guide per genre and tempo
    tempo_bpm_map = {
        'electronic': {'slow': 110, 'medium': 124, 'fast': 138},
        'hip-hop': {'slow': 75, 'medium': 90, 'fast': 140},
        'trap': {'slow': 130, 'medium': 140, 'fast': 160},
        'synthwave': {'slow': 95, 'medium': 115, 'fast': 130},
        'rock': {'slow': 90, 'medium': 120, 'fast': 150},
        'metal': {'slow': 100, 'medium': 135, 'fast': 180},
        'pop': {'slow': 95, 'medium': 118, 'fast': 130},
        'jazz': {'slow': 80, 'medium': 115, 'fast': 160},
        'classical': {'slow': 65, 'medium': 95, 'fast': 140},
        'ambient': {'slow': 60, 'medium': 80, 'fast': 100},
        'folk': {'slow': 85, 'medium': 110, 'fast': 135},
        'reggae': {'slow': 70, 'medium': 80, 'fast': 90},
    }

    for genre, total_g in top_genres.items():
        # Top instruments with probabilities
        top_inst = []
        for inst, c in genre_instruments[genre].most_common(8):
            prob = round(c / total_g, 3)
            top_inst.append({"name": inst, "weight": prob})

        # Top moods with probabilities
        top_m = []
        for m, c in genre_moods[genre].most_common(6):
            prob = round(c / total_g, 3)
            top_m.append({"name": m, "weight": prob})

        # Tempos
        tempos = dict(genre_tempos[genre])

        # Recommended BPM
        default_bpm = tempo_bpm_map.get(genre, {'slow': 80, 'medium': 120, 'fast': 140})

        model["genres"][genre] = {
            "count": total_g,
            "instruments": top_inst,
            "moods": top_m,
            "tempos": tempos,
            "recommendedBpm": default_bpm,
            "exemplars": genre_exemplars[genre][:4]
        }

    for m, total_m in mood_counts.most_common(25):
        top_inst = [{"name": inst, "weight": round(c / total_m, 3)}
                    for inst, c in mood_instruments[m].most_common(6)]
        model["moods"][m] = {
            "count": total_m,
            "recommendedInstruments": top_inst
        }

    for inst, c in instrument_counts.most_common(25):
        model["instruments"][inst] = {
            "count": c,
            "compatibleInstruments": [pair[0] for pair in instrument_cooccur[inst].most_common(5)]
        }

    # Save to data/music_tag_model.json
    out_path = 'data/music_tag_model.json'
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(model, f, indent=2)

    print(f"Model generated successfully -> {out_path} ({os.path.getsize(out_path)} bytes)")
    print(f"Top 5 Genres: {[g for g, _ in Counter(top_genres).most_common(5)]}")

if __name__ == '__main__':
    train()
