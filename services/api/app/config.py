from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    database_url: str = "postgresql+asyncpg://deepspec:deepspec@localhost:5432/deepspec"
    minio_endpoint: str = "localhost:9000"
    minio_access_key: str = "deepspec"
    minio_secret_key: str = "deepspec_secret_change_me"
    minio_bucket: str = "deepspec-artifacts"
    minio_secure: bool = False


@lru_cache
def get_settings() -> Settings:
    return Settings()
