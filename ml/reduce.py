import json
import os
from typing import Optional

import numpy as np
from sklearn.decomposition import PCA


def load_or_fit_pca(vectors_896: np.ndarray, pca_path: str, out_dim: int = 256) -> PCA:
    """
    Fit PCA on provided vectors and persist. If exists, load it.
    vectors_896: [N, 896]
    """
    if os.path.exists(pca_path):
        with open(pca_path, "r", encoding="utf-8") as f:
            payload = json.load(f)
        pca = PCA(n_components=out_dim)
        pca.mean_ = np.asarray(payload["mean"], dtype=np.float64)
        pca.components_ = np.asarray(payload["components"], dtype=np.float64)
        pca.n_features_in_ = 896
        return pca

    if vectors_896.ndim != 2 or vectors_896.shape[1] != 896:
        raise ValueError("vectors_896 must be [N,896]")
    if vectors_896.shape[0] < out_dim:
        # Not enough data to fit PCA; fall back to identity-ish truncation.
        # (Still returns a "PCA-like" object for transform compatibility.)
        pca = PCA(n_components=out_dim)
        pca.mean_ = np.zeros((896,), dtype=np.float64)
        comp = np.zeros((out_dim, 896), dtype=np.float64)
        comp[:, :out_dim] = np.eye(out_dim, dtype=np.float64)
        pca.components_ = comp
        pca.n_features_in_ = 896
        _save_pca(pca, pca_path)
        return pca

    pca = PCA(n_components=out_dim, svd_solver="auto", random_state=42)
    pca.fit(vectors_896.astype(np.float64))
    _save_pca(pca, pca_path)
    return pca


def _save_pca(pca: PCA, pca_path: str) -> None:
    payload = {
        "mean": pca.mean_.tolist(),
        "components": pca.components_.tolist(),
    }
    os.makedirs(os.path.dirname(pca_path) or ".", exist_ok=True)
    with open(pca_path, "w", encoding="utf-8") as f:
        json.dump(payload, f)


def reduce_896_to_256(pca: PCA, vec_896: np.ndarray) -> np.ndarray:
    v = np.asarray(vec_896, dtype=np.float64).reshape(1, -1)
    if v.shape[1] != 896:
        raise ValueError("Expected 896-d input")
    out = pca.transform(v)[0].astype(np.float32)
    # Normalize for inner-product search
    norm = np.linalg.norm(out) + 1e-12
    out = out / norm
    if out.shape[0] != 256:
        raise ValueError("Expected 256-d output")
    return out

