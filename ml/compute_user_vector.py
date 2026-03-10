import argparse
from typing import Dict, List

import numpy as np

from firestore_client import get_firestore_client

WEIGHTS = {
    "like": 3.0,
    "comment": 4.0,
    "save": 5.0,
    "view": 1.0,
}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--user_id", required=True)
    ap.add_argument("--events_collection", default="user_events")
    ap.add_argument("--posts_collection", default="communityPosts")
    ap.add_argument("--limit", type=int, default=2000)
    args = ap.parse_args()

    client = get_firestore_client()
    events_col = client.collection(args.events_collection)
    posts_col = client.collection(args.posts_collection)

    # Pull recent events for user
    # (Firestore queries with multiple event_types can be done client-side after fetch)
    docs = events_col.where("user_id", "==", args.user_id).limit(args.limit).stream()

    weighted = []
    total_w = 0.0
    used = 0
    for d in docs:
        e = d.to_dict() or {}
        et = (e.get("event_type") or "").strip()
        if et not in WEIGHTS:
            continue
        post_id = (e.get("post_id") or "").strip()
        if not post_id:
            continue
        w = WEIGHTS[et]

        post_doc = posts_col.document(post_id).get()
        if not post_doc.exists:
            continue
        pdata = post_doc.to_dict() or {}
        v = pdata.get("embedding_vector")
        if not isinstance(v, list) or len(v) != 256:
            continue

        vec = np.asarray(v, dtype=np.float32)
        weighted.append(vec * w)
        total_w += w
        used += 1

    if used == 0 or total_w <= 0:
        print("No usable events/embeddings found for this user.")
        return

    user_vec = np.sum(np.stack(weighted, axis=0), axis=0) / total_w
    # Normalize
    norm = np.linalg.norm(user_vec) + 1e-12
    user_vec = (user_vec / norm).astype(np.float32)

    print("✅ user_vector (256 dims):")
    print(user_vec.tolist())


if __name__ == "__main__":
    main()

