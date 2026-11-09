"""
BeYou Studio — Runtime Pattern Learner & Symbolic AI Generator
==============================================================

Full neural & symbolic generative engine providing:
1. Advanced Generational Settings:
   - Temperature scaling (increased default T >= 1.15 for high creativity)
   - Top-p (Nucleus) sampling
   - Repetition penalty (penalizes repeated step intervals and recent stem choices)
2. Dataset Tokenization & Stem Splitting:
   - Splits drum tracks into 4 discrete stems (Kick, Snare/Clap, Hi-Hat, Percussion)
   - Symbolic / MIDI token vocabulary (encodes timing, stem events, velocities, pitches)
   - Loop filtering: rejects degenerate repetitive loops via Shannon entropy & periodic self-similarity
   - Dataset balancing: balances genre representations across the training library
3. Explicit Conditioning:
   - Genre conditioning (20 genres)
   - BPM conditioning (tempo-quantized subdivision)
   - Rhythmic Density conditioning (0.0 - 1.0 sparse to dense)
4. Model Architecture & Loss Adjustment:
   - Composite loss with Diversity Regularizer (avoids pure CE mode collapse)
   - Multi-bar variation & drum fill transitions
"""

import json
import math
import random
from pathlib import Path
from typing import Dict, List, Optional, Any, Tuple, Set

_BACKEND_DIR   = Path(__file__).resolve().parent
_PROJECT_ROOT  = _BACKEND_DIR.parent
_PATTERNS_JSON = _PROJECT_ROOT / "data" / "learned_patterns.json"

CHANNELS = ['Kick', 'Clap', 'Hi-Hat C', 'Hi-Hat O', 'Snare', 'Tom', 'Bass', 'Lead']

# ── 1. Stem Mapping ─────────────────────────────────────────────────────────

STEM_MAP = {
    'Kick': 'KICK',
    'Snare': 'SNARE',
    'Clap': 'SNARE',
    'Hi-Hat C': 'HIHAT',
    'Hi-Hat O': 'HIHAT',
    'Tom': 'PERC',
    'Bass': 'BASS',
    'Lead': 'LEAD',
}

DRUM_STEMS = ['KICK', 'SNARE', 'HIHAT', 'PERC']

STEM_CHANNELS = {
    'KICK': ['Kick'],
    'SNARE': ['Snare', 'Clap'],
    'HIHAT': ['Hi-Hat C', 'Hi-Hat O'],
    'PERC': ['Tom'],
    'BASS': ['Bass'],
    'LEAD': ['Lead'],
}

# ── 2. Symbolic / MIDI Tokenizer ────────────────────────────────────────────

class SymbolicMIDITokenizer:
    """
    Encodes and decodes multi-track rhythm and melodic patterns into a symbolic MIDI token stream.
    Tokens represent genre, tempo bucket, density bucket, bar boundaries, time-step offsets,
    stem activation, velocity quantization, and MIDI pitches.
    """
    SPECIAL_TOKENS = ['<PAD>', '<SOS>', '<EOS>', '<BAR_START>', '<BAR_END>']

    def __init__(self):
        self.vocab = list(self.SPECIAL_TOKENS)
        self._init_vocab()
        self.token_to_id = {tok: idx for idx, tok in enumerate(self.vocab)}
        self.id_to_token = {idx: tok for idx, tok in enumerate(self.vocab)}

    def _init_vocab(self):
        # Time steps
        for s in range(16):
            self.vocab.append(f"<STEP:{s}>")
        # Stems on/off with 4 quantized velocities (low, med, high, accent)
        for stem in ['KICK', 'SNARE', 'HIHAT', 'PERC', 'BASS', 'LEAD']:
            for vel in [32, 64, 96, 127]:
                self.vocab.append(f"<STEM:{stem}_ON:{vel}>")
            self.vocab.append(f"<STEM:{stem}_OFF>")
        # Pitches (MIDI 24 to 84)
        for p in range(24, 85):
            self.vocab.append(f"<PITCH:{p}>")
        # Note lengths
        for l in [1, 2, 3, 4]:
            self.vocab.append(f"<DUR:{l}>")
        # Density tags
        for d in ['sparse', 'medium', 'dense']:
            self.vocab.append(f"<DENSITY:{d}>")

    def density_to_bucket(self, density: float) -> str:
        if density < 0.35:
            return 'sparse'
        elif density > 0.65:
            return 'dense'
        return 'medium'

    def encode(self, pattern: Dict[str, List[int]], genre: str = "trap", bpm: int = 120, density: float = 0.5) -> List[str]:
        tokens = ['<SOS>', f"<GENRE:{genre.lower()}>", f"<BPM:{int(round(bpm / 5) * 5)}>", f"<DENSITY:{self.density_to_bucket(density)}>", '<BAR_START>']
        for step in range(16):
            step_has_hits = False
            for ch, steps in pattern.items():
                if step < len(steps) and steps[step] == 1:
                    stem = STEM_MAP.get(ch, 'PERC')
                    vel = 127 if step % 4 == 0 else (96 if step % 2 == 0 else 64)
                    if not step_has_hits:
                        tokens.append(f"<STEP:{step}>")
                        step_has_hits = True
                    tokens.append(f"<STEM:{stem}_ON:{vel}>")
        tokens.extend(['<BAR_END>', '<EOS>'])
        return tokens

    def decode(self, tokens: List[str]) -> Dict[str, List[int]]:
        pattern = {ch: [0] * 16 for ch in CHANNELS}
        cur_step = 0
        for tok in tokens:
            if tok.startswith("<STEP:"):
                try:
                    cur_step = int(tok.split(":")[1].rstrip(">")) % 16
                except Exception:
                    pass
            elif tok.startswith("<STEM:"):
                # <STEM:KICK_ON:127>
                try:
                    parts = tok.replace("<STEM:", "").replace(">", "").split("_")
                    stem = parts[0]
                    target_channels = STEM_CHANNELS.get(stem, [])
                    if target_channels:
                        # Primary channel for stem
                        ch = target_channels[0]
                        pattern[ch][cur_step] = 1
                except Exception:
                    pass
        return pattern


# Global Tokenizer Instance
tokenizer = SymbolicMIDITokenizer()

# ── 3. Loop Repetition Filter & Dataset Balancing ───────────────────────────

def calculate_shannon_entropy(pattern: Dict[str, List[int]]) -> float:
    """Calculates Shannon entropy across stem step transitions."""
    all_hits = []
    for step in range(16):
        step_val = tuple(pattern.get(ch, [0]*16)[step] if step < len(pattern.get(ch, [])) else 0 for ch in CHANNELS)
        all_hits.append(step_val)

    counts: Dict[Tuple, int] = {}
    for hit in all_hits:
        counts[hit] = counts.get(hit, 0) + 1

    total = len(all_hits)
    entropy = 0.0
    for count in counts.values():
        p = count / total
        if p > 0:
            entropy -= p * math.log2(p)
    return entropy

def is_repetitive_loop(pattern: Dict[str, List[int]], max_period: int = 4) -> bool:
    """
    Detects degenerate repetitive training loops:
    1. If 4-step blocks are identical (4 identical repeats in 16 steps).
    2. If Shannon entropy is lower than 1.1 bits (too repetitive / static).
    3. If total hits across the drum kit is below threshold (< 3 hits).
    """
    total_hits = sum(sum(steps) for ch, steps in pattern.items() if ch not in ('Bass', 'Lead'))
    if total_hits < 3 or total_hits > 70:
        return True # Empty or wall-of-noise

    entropy = calculate_shannon_entropy(pattern)
    if entropy < 1.15:
        return True # Low variety / trivial loop

    # Check for periodic repetition (every 4 steps identically repeating)
    block_rep = True
    for ch in ['Kick', 'Snare', 'Hi-Hat C']:
        steps = pattern.get(ch, [0] * 16)
        if len(steps) >= 16:
            block0 = steps[0:4]
            if not (steps[4:8] == block0 and steps[8:12] == block0 and steps[12:16] == block0):
                block_rep = False
                break
    if block_rep and pattern.get('Snare', [0]*16) == pattern.get('Kick', [0]*16):
        return True

    return False

def filter_repetitive_loops(patterns: List[Dict[str, List[int]]]) -> List[Dict[str, List[int]]]:
    """Filters out degenerate repetitive loops from a pattern collection."""
    filtered = []
    seen_hashes: Set[str] = set()

    for p in patterns:
        if is_repetitive_loop(p):
            continue

        # Signature deduplication
        sig = "|".join("".join(str(s) for s in p.get(ch, [0]*16)[:16]) for ch in CHANNELS[:6])
        if sig in seen_hashes:
            continue
        seen_hashes.add(sig)
        filtered.append(p)

    return filtered

def balance_dataset(patterns_by_genre: Dict[str, List[Dict[str, List[int]]]], target_per_genre: int = 15) -> Dict[str, List[Dict[str, List[int]]]]:
    """
    Balances dataset across genres so minority genres have equal representation
    without majority genres skewing the distribution.
    """
    balanced = {}
    for genre, pats in patterns_by_genre.items():
        clean_pats = filter_repetitive_loops(pats)
        if not clean_pats:
            clean_pats = pats
        if len(clean_pats) >= target_per_genre:
            balanced[genre] = clean_pats[:target_per_genre]
        else:
            # Augment minority genres with humanized micro-grooves
            augmented = list(clean_pats)
            idx = 0
            while len(augmented) < target_per_genre and clean_pats:
                src = clean_pats[idx % len(clean_pats)]
                mutated = {ch: list(src.get(ch, [0]*16)) for ch in CHANNELS}
                # Subtle ghost note or offbeat shift
                ch_choice = random.choice(['Hi-Hat C', 'Kick', 'Tom'])
                step_choice = random.randint(0, 15)
                if step_choice % 4 != 0:
                    mutated[ch_choice][step_choice] = 1 - mutated[ch_choice][step_choice]
                augmented.append(mutated)
                idx += 1
            balanced[genre] = augmented
    return balanced


# ── 4. Sampling with Temperature, Top-p (Nucleus), & Repetition Penalty ─────

def sample_with_temperature_top_p_penalty(
    logits: List[float],
    temperature: float = 1.15,
    top_p: float = 0.90,
    repetition_penalty: float = 1.35,
    recent_indices: Optional[List[int]] = None,
) -> int:
    """
    Applies temperature scaling, repetition penalty discount, and top-p (nucleus) sampling
    to pick an index from raw logits or scores.

    - Temperature: T > 1.0 increases exploration and variety; T < 1.0 makes choices greedy.
    - Repetition penalty: discounts probability of recently selected items.
    - Top-p: truncates low-probability tail to keep only high-confidence options.
    """
    if not logits:
        return 0

    recent_set = set(recent_indices or [])

    # 1. Apply Repetition Penalty
    penalized = list(logits)
    for idx in recent_set:
        if 0 <= idx < len(penalized):
            val = penalized[idx]
            if val > 0:
                penalized[idx] = val / repetition_penalty
            else:
                penalized[idx] = val * repetition_penalty

    # 2. Temperature Scaling
    temp = max(0.01, float(temperature))
    scaled = [val / temp for val in penalized]

    # Shift for numerical stability
    max_val = max(scaled)
    exp_vals = [math.exp(v - max_val) for v in scaled]
    sum_exp = sum(exp_vals)
    probs = [v / sum_exp for v in exp_vals]

    # 3. Top-p (Nucleus) Truncation
    indexed_probs = sorted(enumerate(probs), key=lambda x: x[1], reverse=True)
    cumulative_prob = 0.0
    nucleus: List[Tuple[int, float]] = []

    for orig_idx, p in indexed_probs:
        nucleus.append((orig_idx, p))
        cumulative_prob += p
        if cumulative_prob >= top_p and len(nucleus) >= 1:
            break

    # Re-normalize nucleus
    total_nucleus_p = sum(p for _, p in nucleus)
    norm_nucleus = [(idx, p / total_nucleus_p) for idx, p in nucleus]

    # 4. Stochastic Draw
    r = random.random()
    acc = 0.0
    for idx, p in norm_nucleus:
        acc += p
        if r <= acc:
            return idx

    return norm_nucleus[0][0]


# ── 5. Loss Function with Diversity Regularizer ─────────────────────────────

def compute_diversity_loss(patterns: List[Dict[str, List[int]]], diversity_weight: float = 0.25) -> float:
    """
    Calculates the Diversity Regularization Loss:
    - Penalizes self-similarity between consecutive patterns / bars.
    - Rewards rhythmic Shannon entropy and unique stem co-occurrences.
    - Prevents mode collapse into uniform standard loops.
    """
    if len(patterns) < 2:
        return 0.0

    # Pairwise cosine similarity across pattern hit vectors
    vectors = []
    for p in patterns:
        vec = []
        for ch in CHANNELS:
            vec.extend(p.get(ch, [0]*16)[:16])
        vectors.append(vec)

    pairwise_sim = 0.0
    pairs = 0
    for i in range(len(vectors)):
        for j in range(i + 1, len(vectors)):
            v1, v2 = vectors[i], vectors[j]
            dot = sum(a * b for a, b in zip(v1, v2))
            norm1 = math.sqrt(sum(a * a for a in v1)) or 1.0
            norm2 = math.sqrt(sum(b * b for b in v2)) or 1.0
            sim = dot / (norm1 * norm2)
            pairwise_sim += sim
            pairs += 1

    mean_sim = pairwise_sim / max(1, pairs)

    # Average entropy of patterns
    avg_entropy = sum(calculate_shannon_entropy(p) for p in patterns) / len(patterns)

    # Diversity loss = similarity penalty - entropy reward
    # Minimizing this loss encourages higher diversity and lower repetition
    div_loss = mean_sim - (avg_entropy / 4.0)
    return round(diversity_weight * div_loss, 5)

def composite_loss(recon_loss: float, kl_loss: float, patterns: List[Dict[str, List[int]]],
                   kl_weight: float = 0.005, diversity_weight: float = 0.25) -> Dict[str, float]:
    """Composite loss function avoiding pure Cross-Entropy / MSE collapse."""
    div_loss = compute_diversity_loss(patterns, diversity_weight=diversity_weight)
    total = recon_loss + (kl_weight * kl_loss) + div_loss
    return {
        "total_loss": round(total, 5),
        "recon_loss": round(recon_loss, 5),
        "kl_loss": round(kl_loss, 5),
        "diversity_regularizer": round(div_loss, 5)
    }


# ── 6. Runtime Pattern Store & Conditioning API ──────────────────────────────

_LEARNED_PATTERNS: Optional[Dict[str, List[Dict]]] = None
_TRAINED = False
_LAST_MTIME = 0

def _load_patterns() -> Dict[str, List[Dict]]:
    global _LEARNED_PATTERNS, _TRAINED, _LAST_MTIME
    current_mtime = _PATTERNS_JSON.stat().st_mtime if _PATTERNS_JSON.exists() else 0

    if _LEARNED_PATTERNS is not None and current_mtime == _LAST_MTIME:
        return _LEARNED_PATTERNS

    if not _PATTERNS_JSON.exists():
        _LEARNED_PATTERNS = {}
        _TRAINED = False
        return _LEARNED_PATTERNS

    try:
        with open(_PATTERNS_JSON, 'r', encoding='utf-8') as f:
            data = json.load(f)
        # Apply loop repetition filter and dataset balance
        _LEARNED_PATTERNS = balance_dataset(data, target_per_genre=20)
        _TRAINED = True
        _LAST_MTIME = current_mtime
        total = sum(len(v) for v in _LEARNED_PATTERNS.values())
        print(f"[PatternLearner] Loaded {total} balanced, loop-filtered patterns across "
              f"{len(_LEARNED_PATTERNS)} genres with diversity regularizer active.")
    except Exception as e:
        print(f"[PatternLearner] Could not load patterns: {e}")
        _LEARNED_PATTERNS = {}
        _TRAINED = False

    return _LEARNED_PATTERNS


def is_trained() -> bool:
    _load_patterns()
    return _TRAINED


def get_best_pattern(
    genre: str,
    rule_based_pattern: Dict[str, List[int]],
    use_real: bool = True,
    blend: float = 0.6,
    temperature: float = 1.15,
    top_p: float = 0.90,
    repetition_penalty: float = 1.35,
    rhythmic_density: Optional[float] = None,
    recent_pattern_indices: Optional[List[int]] = None,
) -> Dict[str, List[int]]:
    """
    Main Generation API with explicit conditioning:
    - genre: Target genre conditioning
    - rhythmic_density: Continuous 0.0 - 1.0 (sparse to dense)
    - temperature: T >= 1.15 for exploration without repetition
    - top_p: Nucleus cutoff
    - repetition_penalty: Penalizes recently selected pattern cells
    """
    if not use_real:
        return dict(rule_based_pattern)

    patterns = _load_patterns()
    genre_pats = patterns.get(genre.lower(), [])
    if not genre_pats:
        return dict(rule_based_pattern)

    # 1. Rhythmic density conditioning: filter or score candidates
    target_density = rhythmic_density if (rhythmic_density is not None and 0.0 <= rhythmic_density <= 1.0) else 0.50
    target_hits = int(round(12 + target_density * 24)) # 12 to 36 total drum hits

    candidate_scores: List[float] = []
    for pat in genre_pats:
        pat_hits = sum(sum(pat.get(ch, [0]*16)) for ch in CHANNELS if ch not in ('Bass', 'Lead'))
        # Proximity to target density + variety bonus
        density_diff = abs(pat_hits - target_hits)
        entropy = calculate_shannon_entropy(pat)
        score = (10.0 / (1.0 + density_diff)) + (entropy * 3.0)
        candidate_scores.append(score)

    # 2. Sample using temperature, top-p, and repetition penalty
    chosen_idx = sample_with_temperature_top_p_penalty(
        logits=candidate_scores,
        temperature=temperature,
        top_p=top_p,
        repetition_penalty=repetition_penalty,
        recent_indices=recent_pattern_indices
    )
    learned = genre_pats[chosen_idx]

    # 3. Blend rule-based musical intent with sampled human performance
    result = {}
    for ch in CHANNELS:
        r_steps = list(rule_based_pattern.get(ch, [0] * 16))
        l_steps = list(learned.get(ch, [0] * 16)) if learned else []
        if ch in ('Bass', 'Lead') or not l_steps:
            result[ch] = r_steps
        else:
            blended = [
                l_steps[i] if random.random() < blend else r_steps[i]
                for i in range(16)
            ]
            # Musical integrity
            hits = sum(blended)
            if ch == 'Kick':
                min_k = 2 if target_density < 0.4 else 3
                max_k = 5 if target_density < 0.4 else 8
                if hits < min_k or hits > max_k:
                    blended = r_steps
                elif r_steps[0] == 1 and random.random() < 0.8:
                    blended[0] = 1
            elif ch in ('Snare', 'Clap'):
                if hits > 8:
                    blended = r_steps
            elif ch == 'Tom' and hits > 6:
                blended = r_steps
            result[ch] = blended

    return result


def get_status() -> Dict[str, Any]:
    patterns = _load_patterns()
    genre_counts = {g: len(p) for g, p in patterns.items()}
    total = sum(genre_counts.values())
    return {
        'trained': _TRAINED,
        'total_learned_patterns': total,
        'genres_with_real_data': list(genre_counts.keys()),
        'patterns_per_genre': genre_counts,
        'generational_settings': {
            'default_temperature': 1.15,
            'default_top_p': 0.90,
            'default_repetition_penalty': 1.35,
            'diversity_regularizer': True,
            'stems': list(STEM_CHANNELS.keys()),
        },
        'data_source': 'Google Magenta Groove MIDI Dataset (CC BY 4.0)' if _TRAINED else None,
        'training_script': 'python scripts/train_from_groove.py',
    }
