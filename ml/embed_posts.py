import argparse
from typing import Dict, List, Optional, Tuple

import numpy as np
from google.cloud.firestore import FieldFilter

from firestore_client import get_firestore_client
from embeddings import load_models, text_embedding, image_embedding, concat_embedding
from reduce import load_or_fit_pca, reduce_896_to_256


def _get_post_text(doc_data: Dict) -> str:
    # Community posts use `content` (see CommunityPage.js)
    return (doc_data.get("content") or doc_data.get("text") or "").strip()


def _get_post_image_url(doc_data: Dict) -> str:
    # Community posts use `image`
    return (doc_data.get("image") or "").strip()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--collection", default="communityPosts")
    ap.add_argument("--limit", type=int, default=500)
    ap.add_argument("--pca", default="ml/pca_896_to_256.json")
    ap.add_argument("--update", action="store_true", help="Write embeddings back to Firestore")
    ap.add_argument("--write_896", action="store_true", help="Also write embedding_vector_896")
    args = ap.parse_args()

    client = get_firestore_client()
    models = load_models()

    # Read posts (limit newest first if createdAt exists)
    col = client.collection(args.collection)
    docs = col.limit(args.limit).stream()
    posts = []
    for d in docs:
        data = d.to_dict() or {}
        posts.append((d.id, data))

    if not posts:
        print("No posts found.")
        return

    # First pass: build 896 vectors (so PCA can fit on corpus)
    vectors_896 = []
    for post_id, data in posts:
        t = _get_post_text(data)
        img = _get_post_image_url(data)
        te = text_embedding(models, t)
        ie = image_embedding(models, img)
        v896 = concat_embedding(te, ie)
        vectors_896.append(v896)

    vectors_896 = np.stack(vectors_896, axis=0)
    pca = load_or_fit_pca(vectors_896, args.pca, out_dim=256)

    # Reduce + optionally write back
    if args.update:
        batch = client.batch()
        for i, (post_id, data) in enumerate(posts):
            v896 = vectors_896[i]
            v256 = reduce_896_to_256(pca, v896)
            ref = col.document(post_id)
            payload = {
                "embedding_vector": v256.tolist(),
            }
            if args.write_896:
                payload["embedding_vector_896"] = v896.astype(np.float32).tolist()
            batch.set(ref, payload, merge=True)
        batch.commit()
        print(f"✅ Updated {len(posts)} posts with embedding_vector (256 dims).")
    else:
        print(f"Computed embeddings for {len(posts)} posts (not written).")


if __name__ == "__main__":
    main()

