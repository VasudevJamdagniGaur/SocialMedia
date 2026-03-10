## Deite ML pipeline (Phase 1)

This folder contains **offline / backend** utilities to generate **post embeddings**, build a **FAISS** index, and compute a **user vector** from `user_events`.

### What gets written to Firestore

- **Collection**: `communityPosts` (posts)
- **Field added**: `embedding_vector` (list of floats, length **256**)
- Optional debug fields:
  - `embedding_vector_896` (list of floats, length **896**) *(disabled by default)*
  - `embedding_updated_at` (server timestamp)

### Embedding specs

- **Text embedding**: `all-MiniLM-L6-v2` → 384 dims
- **Image embedding**: CLIP image encoder (`openai/clip-vit-base-patch32`) → 512 dims
- **Concatenate**: 384 + 512 = **896**
- **Reduce**: PCA **896 → 256** (fitted on your corpus; saved locally)

### Prereqs

- Python 3.10+
- Install:

```bash
pip install -r ml/requirements.txt
```

### Firebase credentials

Set Google Application Credentials (service account JSON):

- Windows PowerShell:

```powershell
$env:GOOGLE_APPLICATION_CREDENTIALS="C:\path\to\serviceAccount.json"
```

### 1) Generate / update embeddings for posts

```bash
python ml/embed_posts.py --collection communityPosts --limit 500 --update
```

What it does:
- reads posts from Firestore
- computes embeddings
- writes `embedding_vector` back into the post document

### 2) Build FAISS index from embeddings

```bash
python ml/build_faiss_index.py --collection communityPosts --out ml/faiss.index --map ml/faiss_map.json
```

### 3) Compute a user vector from events (weights)

Weights:
- like = 3
- comment = 4
- save = 5
- view = 1

```bash
python ml/compute_user_vector.py --user_id <UID> --events_collection user_events --posts_collection communityPosts
```

### Notes

- This is designed to run as a **backend job** (Cloud Run / VM / GitHub Actions runner), not in the mobile/web UI.
- For production, you’d typically trigger embedding generation on new post writes (Cloud Function → Pub/Sub → worker).

