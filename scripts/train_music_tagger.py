#!/usr/bin/env python3
"""
BeYou Studio — Music Tag & Caption Generator Fine-Tuning Pipeline
==================================================================
Trains / fine-tunes a language model (e.g., Qwen2.5-0.5B, GPT-2, LLaMA)
on the `wanghappy/Music-tag-generation` dataset (53,053 Qwen-Audio 2.0 captions).

Usage Examples:
  # 1. Quick test / preview formatted training samples:
  python3 scripts/train_music_tagger.py --preview

  # 2. Run local LoRA fine-tuning on a lightweight model (Qwen2.5-0.5B or gpt2):
  python3 scripts/train_music_tagger.py --model_name gpt2 --epochs 3 --batch_size 4 --output_dir ./trained_music_tagger

  # 3. Full training with LoRA:
  python3 scripts/train_music_tagger.py --model_name Qwen/Qwen2.5-0.5B --lora --epochs 3 --output_dir ./qwen_music_tagger
"""

import os
import sys
import json
import re
import argparse
import urllib.request
from typing import List, Dict, Any

HF_DATASET_URLS = {
    'MTG': 'https://huggingface.co/datasets/wanghappy/Music-tag-generation/raw/main/MTG-Jamendo/MTG-Qwen.json',
    'MAG': 'https://huggingface.co/datasets/wanghappy/Music-tag-generation/raw/main/Magnatune/MAG-Qwen.json'
}

def ensure_dataset(data_dir: str = 'data') -> List[Dict[str, Any]]:
    """Download and load the Music-tag-generation dataset."""
    os.makedirs(data_dir, exist_ok=True)
    all_records = []

    for name, url in HF_DATASET_URLS.items():
        local_path = os.path.join(data_dir, f"{name}-Qwen.json")
        if not os.path.exists(local_path):
            print(f"[Dataset] Downloading {name}-Qwen.json from Hugging Face...")
            urllib.request.urlretrieve(url, local_path)
            print(f"[Dataset] Saved {local_path} ({os.path.getsize(local_path):,} bytes)")

        with open(local_path, 'r', encoding='utf-8') as f:
            records = json.load(f)
            print(f"[Dataset] Loaded {len(records):,} records from {local_path}")
            all_records.extend(records)

    print(f"[Dataset] Total combined dataset size: {len(all_records):,} records")
    return all_records

def parse_caption_to_tags(caption: str) -> Dict[str, Any]:
    """Extract structured tags from a Qwen-Audio caption."""
    lower = caption.lower()

    # Extract Genre
    genre = 'unknown'
    gm = re.search(r'genre (?:of (?:the )?music piece )?is ([^,\.]+)', lower)
    if gm:
        genre = gm.group(1).strip()
        genre = re.sub(r'^(the\s+|a\s+|an\s+)', '', genre)
        genre = re.sub(r'\s+music(\s+piece)?$', '', genre)

    # Extract Tempo
    tempo = 'medium'
    if re.search(r'\bfast\b|\buptempo\b|\brapid\b', lower):
        tempo = 'fast'
    elif re.search(r'\bslow\b|\bdowntempo\b|\bcalm\b', lower):
        tempo = 'slow'

    # Extract Instruments
    canonical_insts = [
        'synthesizer', 'drum machine', 'drums', 'electric guitar', 'acoustic guitar',
        'bass', 'piano', 'strings', 'violin', 'cello', 'harp', 'trumpet', 'saxophone',
        'flute', 'clarinet', 'human voice', 'organ', 'percussion'
    ]
    instruments = [inst for inst in canonical_insts if re.search(r'\b' + re.escape(inst) + r'(?:s)?\b', lower)]

    # Extract Moods
    canonical_moods = [
        'energetic', 'lively', 'upbeat', 'exciting', 'groovy', 'calm', 'peaceful',
        'soothing', 'gentle', 'serene', 'dark', 'ominous', 'sad', 'melancholic',
        'somber', 'aggressive', 'angry', 'intense', 'happy', 'passionate', 'dramatic'
    ]
    moods = [m for m in canonical_moods if re.search(r'\b' + re.escape(m) + r'\b', lower)]

    return {
        'genre': genre,
        'tempo': tempo,
        'instruments': instruments,
        'moods': moods
    }

def format_instruction_sample(caption: str) -> Dict[str, str]:
    """
    Format a record into an instruction-following prompt/completion pair.
    Task: Given music production tags, generate a natural language studio description.
    """
    tags = parse_caption_to_tags(caption)
    inst_str = ", ".join(tags['instruments']) if tags['instruments'] else "standard arrangement"
    mood_str = ", ".join(tags['moods']) if tags['moods'] else "neutral"

    instruction = (
        f"Generate a studio music production description for the following DAW tags:\n"
        f"Genre: {tags['genre']}\n"
        f"Tempo: {tags['tempo']}\n"
        f"Instruments: {inst_str}\n"
        f"Mood: {mood_str}"
    )

    return {
        "instruction": instruction,
        "input": "",
        "output": caption.strip(),
        "text": f"### Instruction:\n{instruction}\n\n### Response:\n{caption.strip()}"
    }

def prepare_dataset(records: List[Dict[str, Any]], max_samples: int = None) -> List[Dict[str, str]]:
    """Format and filter dataset for training."""
    if max_samples and max_samples < len(records):
        records = records[:max_samples]

    dataset = []
    for r in records:
        caption = r.get('caption', '')
        if caption and len(caption) > 30:
            dataset.append(format_instruction_sample(caption))

    return dataset

def run_preview(dataset: List[Dict[str, str]]):
    """Print sample formatted training instances."""
    print("\n" + "=" * 70)
    print("  SAMPLE TRAINING INSTRUCTION PAIRS (Music-Tag-Generation)")
    print("=" * 70)
    for i, item in enumerate(dataset[:3]):
        print(f"\n--- Sample #{i+1} ---")
        print(item['text'])
    print("\n" + "=" * 70)

def train_model(args):
    """Train or fine-tune with HuggingFace transformers and PEFT (LoRA)."""
    try:
        import torch
        from transformers import (
            AutoModelForCausalLM,
            AutoTokenizer,
            TrainingArguments,
            Trainer,
            DataCollatorForSeq2Seq
        )
        from datasets import Dataset
    except ImportError:
        print("[Error] Missing dependencies. Please run:\n  pip install torch transformers datasets peft accelerate")
        sys.exit(1)

    print(f"\n[Training] Initializing training on model: {args.model_name}")

    # Detect device
    if torch.cuda.is_available():
        device = "cuda"
    elif hasattr(torch.backends, 'mps') and torch.backends.mps.is_available():
        device = "mps"
    else:
        device = "cpu"
    print(f"[Training] Using compute device: {device}")

    # Load data
    raw_records = ensure_dataset(args.data_dir)
    formatted = prepare_dataset(raw_records, max_samples=args.max_samples)
    print(f"[Training] Formatted {len(formatted):,} instruction samples.")

    # Split train / eval
    val_size = int(len(formatted) * 0.05)
    train_data = formatted[val_size:]
    val_data = formatted[:val_size]

    hf_train = Dataset.from_list(train_data)
    hf_val = Dataset.from_list(val_data)

    # Tokenizer
    print(f"[Training] Loading tokenizer for {args.model_name}...")
    tokenizer = AutoTokenizer.from_pretrained(args.model_name, trust_remote_code=True)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token

    def tokenize_fn(examples):
        return tokenizer(examples['text'], truncation=True, max_length=args.max_length, padding="max_length")

    print("[Training] Tokenizing datasets...")
    tokenized_train = hf_train.map(tokenize_fn, batched=True, remove_columns=hf_train.column_names)
    tokenized_val = hf_val.map(tokenize_fn, batched=True, remove_columns=hf_val.column_names)

    # Model
    print(f"[Training] Loading base model: {args.model_name}...")
    model = AutoModelForCausalLM.from_pretrained(
        args.model_name,
        torch_dtype=torch.float16 if device != "cpu" else torch.float32,
        trust_remote_code=True
    )

    if args.lora:
        try:
            from peft import LoraConfig, get_peft_model, TaskType
            print("[Training] Configuring LoRA fine-tuning...")
            lora_config = LoraConfig(
                task_type=TaskType.CAUSAL_LM,
                r=args.lora_r,
                lora_alpha=args.lora_alpha,
                lora_dropout=0.05,
                target_modules=["q_proj", "v_proj"] if "qwen" in args.model_name.lower() else None
            )
            model = get_peft_model(model, lora_config)
            model.print_trainable_parameters()
        except ImportError:
            print("[Warning] peft package not installed; falling back to standard fine-tuning.")

    # Training arguments
    training_args = TrainingArguments(
        output_dir=args.output_dir,
        num_train_epochs=args.epochs,
        per_device_train_batch_size=args.batch_size,
        per_device_eval_batch_size=args.batch_size,
        learning_rate=args.learning_rate,
        weight_decay=0.01,
        evaluation_strategy="steps",
        eval_steps=100,
        save_steps=200,
        logging_steps=20,
        save_total_limit=2,
        fp16=(device == "cuda"),
        report_to="none"
    )

    trainer = Trainer(
        model=model,
        args=training_args,
        train_dataset=tokenized_train,
        eval_dataset=tokenized_val,
        data_collator=DataCollatorForSeq2Seq(tokenizer, pad_to_multiple_of=8, return_tensors="pt")
    )

    print("\n[Training] Starting fine-tuning run...")
    trainer.train()

    print(f"\n[Training] Saving model to {args.output_dir}...")
    model.save_pretrained(args.output_dir)
    tokenizer.save_pretrained(args.output_dir)
    print(f"[✓] Training complete! Artifacts saved in: {args.output_dir}")

def main():
    parser = argparse.ArgumentParser(description="Fine-tune a model on wanghappy/Music-tag-generation")
    parser.add_argument("--data_dir", type=str, default="data", help="Directory for dataset cache")
    parser.add_argument("--model_name", type=str, default="gpt2", help="Hugging Face model ID (e.g. gpt2, Qwen/Qwen2.5-0.5B)")
    parser.add_argument("--output_dir", type=str, default="./trained_music_tagger", help="Output directory for weights")
    parser.add_argument("--epochs", type=int, default=3, help="Number of training epochs")
    parser.add_argument("--batch_size", type=int, default=4, help="Batch size per device")
    parser.add_argument("--learning_rate", type=float, default=5e-5, help="Learning rate")
    parser.add_argument("--max_length", type=int, default=128, help="Max sequence length")
    parser.add_argument("--max_samples", type=int, default=None, help="Limit training samples (e.g. 5000 for quick run)")
    parser.add_argument("--lora", action="store_true", help="Enable LoRA parameter-efficient fine-tuning")
    parser.add_argument("--lora_r", type=int, default=8, help="LoRA rank")
    parser.add_argument("--lora_alpha", type=int, default=16, help="LoRA alpha")
    parser.add_argument("--preview", action="store_true", help="Only preview formatted dataset samples and exit")

    args = parser.parse_args()

    if args.preview:
        records = ensure_dataset(args.data_dir)
        dataset = prepare_dataset(records, max_samples=10)
        run_preview(dataset)
        return

    train_model(args)

if __name__ == '__main__':
    main()
