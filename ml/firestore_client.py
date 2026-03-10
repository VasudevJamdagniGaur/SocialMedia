import os
import firebase_admin
from firebase_admin import credentials
from google.cloud import firestore


def get_firestore_client():
    """
    Returns a Firestore client using Application Default Credentials.
    Requires GOOGLE_APPLICATION_CREDENTIALS to point to a service account JSON.
    """
    # firebase_admin isn't strictly required for google-cloud-firestore,
    # but initializing here helps in some deployment contexts.
    if not firebase_admin._apps:
        cred_path = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS", "")
        if cred_path:
            firebase_admin.initialize_app(credentials.Certificate(cred_path))
        else:
            firebase_admin.initialize_app()
    return firestore.Client()

