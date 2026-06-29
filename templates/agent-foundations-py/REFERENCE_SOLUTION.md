# Reference solution (gate only — do not ship in the student template)

`agent/model_call.py` `summarize` body:

```python
def summarize(client: LlmClient, text: str) -> str:
    try:
        response = client.create_message(
            model=MODEL,
            max_tokens=MAX_TOKENS,
            messages=[{"role": "user", "content": f"Summarize in one sentence:\n\n{text}"}],
        )
    except Exception as exc:  # noqa: BLE001 - wrap any client failure
        raise SummarizationError(str(exc)) from exc
    if not getattr(response, "content", None):
        raise SummarizationError("model returned no content")
    return response.content[0].text.strip()
```
