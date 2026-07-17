from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    internal_token: str = "dev-internal-token"
    llm_provider: str = "openai"  # openai (Groq-compatible) | anthropic | groq
    llm_chat_model: str = "llama-3.3-70b-versatile"
    openai_api_key: str = ""
    openai_base_url: str = "https://api.groq.com/openai/v1"
    anthropic_api_key: str = ""
    groq_api_key: str = ""


settings = Settings()
