from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    app_name: str = "IFB Manufacturing Scheduling API"
    database_url: str = f"sqlite:///{(BASE_DIR / 'data' / 'scheduling_v2.db').as_posix()}"
    uploads_dir: str = str(BASE_DIR / "uploads")
    default_target_percent: int = 80
    cors_origins: str = "http://localhost:3000,http://127.0.0.1:3000"
    auth_secret: str = "change-me-in-production"
    default_admin_user: str = "admin"
    default_admin_pass: str = "Admin@123"

    model_config = SettingsConfigDict(
        env_file=str(BASE_DIR / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )


settings = Settings()
