from tutor_agent.settings import settings


def get_chat_model():
    provider = settings.llm_provider.lower()
    if provider == "anthropic":
        from langchain_anthropic import ChatAnthropic

        return ChatAnthropic(
            model=settings.llm_chat_model, api_key=settings.anthropic_api_key
        )
    if provider == "groq":
        from langchain_groq import ChatGroq

        return ChatGroq(model=settings.llm_chat_model, api_key=settings.groq_api_key)
    # default: openai-compatible (Groq's /openai/v1, Ollama, etc.)
    from langchain_openai import ChatOpenAI

    return ChatOpenAI(
        model=settings.llm_chat_model,
        api_key=settings.openai_api_key,
        base_url=settings.openai_base_url,
    )
