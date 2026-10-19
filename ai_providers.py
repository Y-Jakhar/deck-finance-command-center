"""Fixed-destination AI transports. Credentials never leave the backend boundary."""

from __future__ import annotations

import json
import math
import os
import re
from pathlib import Path
from typing import Literal

import httpx

Provider = Literal["openrouter", "openai", "gemini", "ollama"]
BASES = {
    "openrouter": "https://openrouter.ai/api/v1",
    "openai": "https://api.openai.com/v1",
    "gemini": "https://generativelanguage.googleapis.com/v1beta/openai",
    "ollama": "http://127.0.0.1:11434",
}
KEY_NAMES = {
    "openrouter": "OPENROUTER_API_KEY",
    "openai": "OPENAI_API_KEY",
    "gemini": "GEMINI_API_KEY",
}
MODEL_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,199}$")


def cloud_model(model):
    return bool(re.search(r"(?:-|:)cloud(?:$|:)", model, re.I))


def number(value):
    if isinstance(value, bool):
        return None
    try:
        parsed = float(value)
        return parsed if math.isfinite(parsed) else None
    except (TypeError, ValueError):
        return None


class ProviderError(Exception):
    """Only predefined, secret-free explanations cross the HTTP boundary."""

    def __init__(self, code: str, message: str):
        self.code, self.message = code, message
        super().__init__(message)


def credential(provider: Provider) -> str:
    if provider == "ollama":
        return ""
    value = os.getenv(KEY_NAMES[provider], "").strip()
    if not value and provider == "openrouter":
        # Preserve OS-level configuration; an external key file is opt-in.
        if os.name == "nt":
            import winreg

            try:
                with winreg.OpenKey(winreg.HKEY_CURRENT_USER, "Environment") as env:
                    value = str(winreg.QueryValueEx(env, KEY_NAMES[provider])[0]).strip()
            except OSError:
                pass
        key_file = os.getenv("RESEARCHDESK_OPENROUTER_KEY_FILE", "").strip()
        if not value and key_file:
            path = Path(key_file)
            try:
                value = path.read_text(encoding="utf-8-sig").strip()
                if value.startswith("OPENROUTER_API_KEY="):
                    value = value.split("=", 1)[1].strip().strip("\"'")
            except OSError:
                pass
    if not value or not value.isascii() or len(value) > 8192 or "\n" in value or "\r" in value:
        raise ProviderError(
            "missing_key", f"Configure {KEY_NAMES[provider]} on the local backend, then retry."
        )
    return value


def redact(text: str) -> str:
    # Scrub provider echoes as well as errors; never log bodies or auth headers.
    text = re.sub(r"(?i)\b(?:sk-[a-z0-9_-]{12,}|AIza[a-z0-9_-]{20,})", "[redacted]", text)
    for provider in KEY_NAMES:
        try:
            secret = credential(provider)
            if secret:
                text = text.replace(secret, "[redacted]")
        except ProviderError:
            pass
    return text


def fail(status: int, payload=None):
    if status < 400:
        return
    error = payload.get("error", {}) if isinstance(payload, dict) else {}
    kind = str(error.get("code", "")).lower() if isinstance(error, dict) else ""
    if isinstance(error, dict) and "context" in str(error.get("message", "")).lower():
        kind = "context_length"
    if "context" in kind or "token" in kind:
        raise ProviderError(
            "context_length",
            "The model context limit was exceeded. Start a new chat or attach less evidence.",
        )
    messages = {
        400: (
            "invalid_request",
            "This model rejected the request or token settings. Check the model and reduce context.",
        ),
        401: (
            "invalid_key",
            "The provider rejected the configured key. Update the local credential.",
        ),
        402: (
            "insufficient_credits",
            "The provider reports insufficient credits. Check your account balance.",
        ),
        403: (
            "provider_limit",
            "The provider denied access or a spending limit was reached. Check account permissions and budgets.",
        ),
        404: (
            "unavailable_model",
            "The selected model or endpoint is unavailable. Refresh models or enter a valid model ID.",
        ),
        429: ("rate_limit", "The provider rate limit was reached. Wait before retrying."),
    }
    code, message = messages.get(
        status,
        ("provider_outage", "The provider is unavailable. Retry later; no success was recorded."),
    )
    raise ProviderError(code, message)


class AIProvider:
    def __init__(self, provider: Provider):
        if provider not in BASES:
            raise ProviderError("invalid_provider", "Provider is not allowlisted.")
        self.provider, self.base = provider, BASES[provider]
        self.price_ceiling = None
        self.headers = (
            {} if provider == "ollama" else {"Authorization": "Bearer " + credential(provider)}
        )
        if provider == "openrouter":
            self.headers.update(
                {"HTTP-Referer": "http://127.0.0.1:8010", "X-Title": "ResearchDesk"}
            )

    def client(self):
        # No redirects, environment proxy overrides, or caller-supplied URLs.
        return httpx.AsyncClient(
            headers=self.headers,
            timeout=httpx.Timeout(90, connect=10),
            follow_redirects=False,
            trust_env=False,
        )

    async def json(self, method, path, body=None):
        try:
            async with self.client() as client:
                response = await client.request(method, self.base + path, json=body)
                if 300 <= response.status_code < 400:
                    raise ProviderError(
                        "redirect_blocked", "Provider redirected to an unapproved destination."
                    )
                try:
                    data = response.json()
                except ValueError:
                    data = {}
                fail(response.status_code, data)
                if not data:
                    raise ProviderError(
                        "invalid_response", "Provider returned an unreadable response."
                    )
                return data
        except httpx.TimeoutException:
            raise ProviderError(
                "timeout", "Provider timed out. Partial output may have been billed."
            ) from None
        except httpx.HTTPError:
            raise ProviderError(
                "connection", "Cannot connect to the provider. Check the local service or network."
            ) from None

    async def models(self):
        data = await self.json("GET", "/api/tags" if self.provider == "ollama" else "/models")
        models = []
        for item in data.get("models" if self.provider == "ollama" else "data", [])[:3000]:
            ident = item.get("name") if self.provider == "ollama" else item.get("id")
            if not isinstance(ident, str) or not MODEL_ID.fullmatch(ident):
                continue
            if redact(ident) != ident:
                continue
            if self.provider == "ollama" and (
                cloud_model(ident) or item.get("remote_host") or item.get("remote_model")
            ):
                continue
            pricing = item.get("pricing", {})
            models.append(
                {
                    "id": ident,
                    "name": redact(str(item.get("name", ident)))[:200],
                    "tools": "tools" in item.get("supported_parameters", []),
                    "pricing": {
                        k: pricing[k] for k in ("prompt", "completion", "request") if k in pricing
                    },
                    "context_length": number(item.get("context_length")),
                }
            )
        return sorted(models, key=lambda x: x["id"])

    async def limits(self):
        if self.provider != "openrouter":
            return None
        data = (await self.json("GET", "/key")).get("data", {})
        # Do not return key labels, hashes or unrelated account details.
        result = {
            k: number(data.get(k)) for k in ("limit", "limit_remaining", "usage", "usage_daily")
        }
        budget = data.get("effective_budget")
        if isinstance(budget, dict):
            result["effective_budget"] = {
                k: number(budget.get(k)) for k in ("limit_usd", "spend_usd", "remaining_usd")
            }
        return result

    async def supports_tools(self, model, catalog):
        if self.provider == "openrouter":
            return any(m["id"] == model and m["tools"] for m in catalog)
        if self.provider == "ollama":
            info = await self.json("POST", "/api/show", {"model": model})
            if cloud_model(model) or info.get("remote_host") or info.get("remote_model"):
                raise ProviderError(
                    "cloud_model",
                    "Ollama Copilot supports locally installed models only. Cloud model aliases are blocked.",
                )
            return "tools" in info.get("capabilities", [])
        # Models endpoints do not advertise function support. A successful explicit
        # Test Connection probe verifies this per model without sending research.
        return False

    async def generate(self, model, messages, tools, tokens, stream=True, force_tool=False):
        if not MODEL_ID.fullmatch(model):
            raise ProviderError(
                "invalid_model", "Enter a valid model ID without whitespace or URL parameters."
            )
        if self.provider == "ollama" and cloud_model(model):
            raise ProviderError(
                "cloud_model", "Choose a locally installed Ollama model; cloud aliases are blocked."
            )
        if self.provider == "openai":
            input_items = []
            for m in messages:
                if m.get("_response_items"):
                    input_items.extend(m["_response_items"])
                elif m["role"] == "tool":
                    input_items.append(
                        {
                            "type": "function_call_output",
                            "call_id": m["tool_call_id"],
                            "output": m["content"],
                        }
                    )
                elif m.get("tool_calls"):
                    if m.get("content"):
                        input_items.append({"role": "assistant", "content": m["content"]})
                    for call in m["tool_calls"]:
                        input_items.append(
                            {
                                "type": "function_call",
                                "call_id": call["id"],
                                "name": call["function"]["name"],
                                "arguments": call["function"]["arguments"],
                            }
                        )
                else:
                    input_items.append(m)
            body = {
                "model": model,
                "input": input_items,
                "max_output_tokens": tokens,
                "stream": stream,
                "store": False,
            }
            if tools:
                body["tools"] = [
                    {"type": "function", **t["function"], "strict": True} for t in tools
                ]
                body["tool_choice"] = "required" if force_tool else "auto"
            path = "/responses"
        elif self.provider == "ollama":
            native_messages = []
            for original in messages:
                message = dict(original)
                if message.get("tool_calls"):
                    message["tool_calls"] = [
                        {
                            "function": {
                                "name": c["function"]["name"],
                                "arguments": json.loads(c["function"]["arguments"]),
                            }
                        }
                        for c in message["tool_calls"]
                    ]
                if message["role"] == "tool":
                    message.pop("tool_call_id", None)
                native_messages.append(message)
            body = {
                "model": model,
                "messages": native_messages,
                "stream": stream,
                "options": {"num_predict": tokens},
            }
            if tools:
                body["tools"] = tools
            path = "/api/chat"
        else:
            body = {"model": model, "messages": messages, "max_tokens": tokens, "stream": stream}
            if self.provider == "openrouter":
                body["provider"] = {"require_parameters": True}
                if self.price_ceiling:
                    body["provider"]["max_price"] = self.price_ceiling
            if stream:
                body["stream_options"] = {"include_usage": True}
            if tools:
                body.update({"tools": tools, "tool_choice": "required" if force_tool else "auto"})
            path = "/chat/completions"
        calls, text, usage, finish, response_items, terminal = {}, "", {}, None, [], False

        def consume(data):
            nonlocal text, usage, finish, response_items, terminal
            delta = ""
            if data.get("error"):
                error = data["error"]
                fail(
                    int(error.get("code", 500)) if isinstance(error.get("code"), int) else 500, data
                )
            if self.provider == "openai":
                kind = data.get("type")
                if kind == "response.output_text.delta":
                    delta = data.get("delta", "")
                elif (
                    kind == "response.output_item.done"
                    and data.get("item", {}).get("type") == "function_call"
                ):
                    c = data["item"]
                    calls[c["call_id"]] = {
                        "id": c["call_id"],
                        "type": "function",
                        "function": {"name": c["name"], "arguments": c["arguments"]},
                    }
                elif kind in ("response.completed", "response.incomplete") or not kind:
                    r = data.get("response", data)
                    response_items = r.get("output", [])
                    u = r.get("usage", {})
                    usage = {
                        "prompt_tokens": u.get("input_tokens"),
                        "completion_tokens": u.get("output_tokens"),
                    }
                    finish = r.get("status")
                    if finish == "failed":
                        raise ProviderError(
                            "provider_failure",
                            "Model generation failed. No completion was recorded.",
                        )
                    terminal = finish in {"completed", "incomplete"}
                    if not stream:
                        for item in r.get("output", []):
                            if item.get("type") == "message":
                                delta += "".join(
                                    c.get("text", "")
                                    for c in item.get("content", [])
                                    if c.get("type") == "output_text"
                                )
                            elif item.get("type") == "function_call":
                                calls[item["call_id"]] = {
                                    "id": item["call_id"],
                                    "type": "function",
                                    "function": {
                                        "name": item["name"],
                                        "arguments": item["arguments"],
                                    },
                                }
                elif kind in ("response.failed", "error"):
                    raise ProviderError(
                        "provider_failure",
                        "Model generation failed. Check model availability and request limits.",
                    )
            elif self.provider == "ollama":
                m = data.get("message", {})
                delta = m.get("content", "")
                for index, call in enumerate(m.get("tool_calls", [])):
                    c = call.get("function", {})
                    key = str(index)
                    calls[key] = {
                        "id": key,
                        "type": "function",
                        "function": {
                            "name": c.get("name", ""),
                            "arguments": json.dumps(c.get("arguments", {})),
                        },
                    }
                if data.get("done"):
                    terminal = True
                    usage = {
                        "prompt_tokens": data.get("prompt_eval_count"),
                        "completion_tokens": data.get("eval_count"),
                    }
                    finish = data.get("done_reason")
            else:
                for choice in data.get("choices", [])[:1]:
                    m = choice.get("delta" if stream else "message", {})
                    delta = m.get("content") or ""
                    finish = choice.get("finish_reason") or finish
                    if choice.get("finish_reason") is not None:
                        terminal = True
                    for c in m.get("tool_calls", []):
                        index = str(c.get("index", c.get("id", "0")))
                        current = calls.setdefault(
                            index,
                            {
                                "id": "",
                                "type": "function",
                                "function": {"name": "", "arguments": ""},
                            },
                        )
                        current["id"] += c.get("id", "")
                        if c.get("extra_content"):
                            current["extra_content"] = c["extra_content"]
                        for k in ("name", "arguments"):
                            current["function"][k] += c.get("function", {}).get(k, "")
                if data.get("usage"):
                    usage = {
                        k: data["usage"].get(k)
                        for k in ("prompt_tokens", "completion_tokens", "total_tokens", "cost")
                    }
            text += delta
            if len(text) > 100_000 or len(json.dumps(calls)) > 30_000:
                raise ProviderError(
                    "response_limit", "Provider response exceeded the local safety limit."
                )
            return delta

        if not stream:
            data = await self.json("POST", path, body)
            delta = consume(data)
            if delta:
                yield {"type": "delta", "text": redact(delta)}
        else:
            try:
                async with self.client() as client:
                    async with client.stream("POST", self.base + path, json=body) as response:
                        if response.status_code != 200:
                            # Never forward raw provider errors (may contain auth or inputs).
                            try:
                                payload = json.loads(await response.aread())
                            except (ValueError, TypeError):
                                payload = {}
                            fail(response.status_code, payload)
                            raise ProviderError("invalid_response", "Unexpected provider response.")
                        async for line in response.aiter_lines():
                            if len(line) > 200_000:
                                raise ProviderError(
                                    "response_limit", "Provider event exceeded the safety limit."
                                )
                            if self.provider != "ollama":
                                if not line.startswith("data:"):
                                    continue
                                line = line[5:].strip()
                                if line == "[DONE]":
                                    break
                            if not line:
                                continue
                            try:
                                delta = consume(json.loads(line))
                            except ValueError:
                                raise ProviderError(
                                    "invalid_response", "Provider sent malformed streaming data."
                                ) from None
                            if delta:
                                # Content is redacted again by the API's boundary buffer.
                                yield {"type": "delta", "text": delta}
            except httpx.TimeoutException:
                raise ProviderError(
                    "timeout", "Generation timed out. Partial output may have been billed."
                ) from None
            except httpx.HTTPError:
                raise ProviderError(
                    "connection",
                    "Provider connection was interrupted. Partial output may have been billed.",
                ) from None
        if not terminal:
            raise ProviderError(
                "incomplete_response",
                "The provider stream ended before a completion marker. Partial output may have been billed.",
            )
        usage = {
            k: number(v)
            for k, v in usage.items()
            if k in {"prompt_tokens", "completion_tokens", "total_tokens", "cost"}
        }
        usage = {k: v if v is not None and v >= 0 else None for k, v in usage.items()}
        yield {
            "type": "result",
            "text": redact(text),
            "calls": list(calls.values()),
            "usage": usage,
            "finish": finish,
            "response_items": response_items,
        }
