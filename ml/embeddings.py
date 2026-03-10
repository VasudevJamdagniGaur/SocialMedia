import io
import json
from dataclasses import dataclass
from typing import Optional, Tuple

import numpy as np
import requests
from PIL import Image

import torch
from sentence_transformers import SentenceTransformer
from transformers import CLIPImageProcessor, CLIPVisionModel


@dataclass
class EmbeddingModels:
    text_model: SentenceTransformer
    clip_processor: CLIPImageProcessor
    clip_vision: CLIPVisionModel
    device: str


def load_models(
    text_model_name: str = "sentence-transformers/all-MiniLM-L6-v2",
    clip_model_name: str = "openai/clip-vit-base-patch32",
) -> EmbeddingModels:
    device = "cuda" if torch.cuda.is_available() else "cpu"
    text_model = SentenceTransformer(text_model_name, device=device)
    clip_processor = CLIPImageProcessor.from_pretrained(clip_model_name)
    clip_vision = CLIPVisionModel.from_pretrained(clip_model_name).to(device)
    clip_vision.eval()
    return EmbeddingModels(
        text_model=text_model,
        clip_processor=clip_processor,
        clip_vision=clip_vision,
        device=device,
    )


def text_embedding(models: EmbeddingModels, text: str) -> np.ndarray:
    t = (text or "").strip()
    if not t:
        return np.zeros((384,), dtype=np.float32)
    emb = models.text_model.encode(t, normalize_embeddings=True)
    emb = np.asarray(emb, dtype=np.float32)
    if emb.shape[0] != 384:
        raise ValueError(f"Expected 384-d text embedding, got {emb.shape}")
    return emb


def _fetch_image_bytes(url: str, timeout: float = 8.0) -> Optional[bytes]:
    if not url or not isinstance(url, str):
        return None
    u = url.strip()
    if not (u.startswith("http://") or u.startswith("https://")):
        return None
    try:
        r = requests.get(u, timeout=timeout)
        if r.status_code != 200:
            return None
        return r.content
    except Exception:
        return None


def image_embedding(models: EmbeddingModels, image_url: str) -> np.ndarray:
    b = _fetch_image_bytes(image_url)
    if not b:
        return np.zeros((512,), dtype=np.float32)

    try:
        img = Image.open(io.BytesIO(b)).convert("RGB")
    except Exception:
        return np.zeros((512,), dtype=np.float32)

    inputs = models.clip_processor(images=img, return_tensors="pt")
    inputs = {k: v.to(models.device) for k, v in inputs.items()}
    with torch.no_grad():
        out = models.clip_vision(**inputs)
        # pooler_output is [batch, hidden] (512 for ViT-B/32)
        pooled = out.pooler_output[0].detach().cpu().numpy().astype(np.float32)
    # Normalize for cosine similarity
    norm = np.linalg.norm(pooled) + 1e-12
    pooled = pooled / norm
    if pooled.shape[0] != 512:
        raise ValueError(f"Expected 512-d image embedding, got {pooled.shape}")
    return pooled


def concat_embedding(text_emb: np.ndarray, img_emb: np.ndarray) -> np.ndarray:
    if text_emb.shape != (384,) or img_emb.shape != (512,):
        raise ValueError("Bad embedding shapes")
    out = np.concatenate([text_emb, img_emb], axis=0).astype(np.float32)
    if out.shape[0] != 896:
        raise ValueError("Bad concat size")
    return out

