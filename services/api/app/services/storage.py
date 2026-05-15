import hashlib
from io import BytesIO

from minio import Minio

from app.config import get_settings


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_prefixed(data: bytes) -> str:
    return f"sha256:{sha256_hex(data)}"


def get_minio_client() -> Minio:
    s = get_settings()
    return Minio(
        s.minio_endpoint,
        access_key=s.minio_access_key,
        secret_key=s.minio_secret_key,
        secure=s.minio_secure,
    )


def ensure_bucket(client: Minio) -> None:
    s = get_settings()
    if not client.bucket_exists(s.minio_bucket):
        client.make_bucket(s.minio_bucket)


def put_bytes(client: Minio, object_key: str, data: bytes, content_type: str = "application/octet-stream") -> None:
    s = get_settings()
    bio = BytesIO(data)
    client.put_object(s.minio_bucket, object_key, bio, length=len(data), content_type=content_type)


def get_bytes(client: Minio, object_key: str) -> bytes:
    s = get_settings()
    obj = client.get_object(s.minio_bucket, object_key)
    try:
        return obj.read()
    finally:
        obj.close()
        obj.release_conn()
