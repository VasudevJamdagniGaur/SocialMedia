import argparse
import json

import numpy as np
import faiss

from firestore_client import get_firestore_client


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--collection", default="communityPosts")
    ap.add_argument("--out", default="ml/faiss.index")
    ap.add_argument("--map", default="ml/faiss_map.json")
    ap.add_argument("--limit", type=int, default=5000)
    args = ap.parse_args()

    client = get_firestore_client()
    col = client.collection(args.collection)

    docs = col.limit(args.limit).stream()
    ids = []
    vecs = []
    for d in docs:
        data = d.to_dict() or {}
        v = data.get("embedding_vector")
        if not isinstance(v, list) or len(v) != 256:
            continue
        ids.append(d.id)
        vecs.append(np.asarray(v, dtype=np.float32))

    if not vecs:
        print("No embedding vectors found.")
        return

    X = np.stack(vecs, axis=0)
    # Use inner product on normalized vectors ~= cosine similarity
    faiss.normalize_L2(X)
    index = faiss.IndexFlatIP(256)
    index.add(X)
    faiss.write_index(index, args.out)

    with open(args.map, "w", encoding="utf-8") as f:
        json.dump({"post_ids": ids}, f)

    print(f"✅ FAISS index built: {len(ids)} vectors → {args.out}")


if __name__ == "__main__":
    main()

