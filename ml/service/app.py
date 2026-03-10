import os
from typing import Optional

import numpy as np
from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel

from ml.embeddings import load_models, text_embedding, image_embedding, concat_embedding
from ml.reduce import load_or_fit_pca, reduce_896_to_256


API_KEY = (os.environ.get("EMBEDDING_SERVICE_API_KEY") or "").strip()
PCA_PATH = os.environ.get("PCA_PATH") or "ml/pca_896_to_256.json"

app = FastAPI(title="Deite Embedding Service", version="1.0")

_models = None
_pca = None


class EmbedRequest(BaseModel):
    post_id: Optional[str] = None
    text_content: Optional[str] = ""
    image_url: Optional[str] = ""


class EmbedResponse(BaseModel):
    embedding_vector: list[float]


@app.on_event("startup")
def _startup():
    global _models, _pca
    _models = load_models()
    # PCA must exist; if it doesn't, we fit a fallback transform on a small identity basis.
    # In production you should fit PCA on your corpus and bake it into the image.
    dummy = np.zeros((300, 896), dtype=np.float32)  # enough rows to fit fallback safely
    _pca = load_or_fit_pca(dummy, PCA_PATH, out_dim=256)


def _auth(authorization: Optional[str]):
    if not API_KEY:
        return
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing Authorization")
    token = authorization.split(" ", 1)[1].strip()
    if token != API_KEY:
        raise HTTPException(status_code=403, detail="Invalid token")


@app.post("/embed", response_model=EmbedResponse)
def embed(req: EmbedRequest, authorization: Optional[str] = Header(default=None)):
    _auth(authorization)
    text = (req.text_content or "").strip()
    img = (req.image_url or "").strip()

    te = text_embedding(_models, text)
    ie = image_embedding(_models, img)
    v896 = concat_embedding(te, ie)
    v256 = reduce_896_to_256(_pca, v896)
    return EmbedResponse(embedding_vector=v256.astype(np.float32).tolist())

