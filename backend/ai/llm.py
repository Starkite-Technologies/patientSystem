"""Minimal Anthropic Messages API client with structured (tool-forced) JSON output.

Every call either returns validated JSON or raises AIUnavailable, so callers can
fall back to the rule-based engine. The demo must never break on stage.
"""
from __future__ import annotations

import json
import os
import re
from pathlib import Path

import httpx

API_URL = 'https://api.anthropic.com/v1/messages'
PROMPTS = Path(__file__).with_name('prompts')
TIMEOUT = httpx.Timeout(20.0, connect=5.0)


class AIUnavailable(Exception):
    pass


def model() -> str:
    return os.getenv('ANTHROPIC_MODEL', '').strip() or 'claude-sonnet-5-5'


def available() -> bool:
    return bool(os.getenv('ANTHROPIC_API_KEY', '').strip()) and os.getenv('AI_DISABLED', 'false').lower() != 'true'


def status() -> dict:
    if os.getenv('AI_DISABLED', 'false').lower() == 'true':
        return {'available': False, 'mode': 'rules', 'message': 'AI switched off (AI_DISABLED). Using the rule-based engine.'}
    if not available():
        return {'available': False, 'mode': 'rules', 'message': 'No AI key configured. Using the rule-based engine.'}
    return {'available': True, 'mode': 'ai', 'model': model(), 'message': f'AI assistant: Claude ({model()}). Suggestions only.'}


def load_prompt(name: str) -> tuple[str, str]:
    """Return (text, version) for the highest-versioned prompts/<name>.vN.md."""
    candidates = sorted(PROMPTS.glob(f'{name}.v*.md'), key=lambda p: int(re.search(r'\.v(\d+)\.md$', p.name).group(1)))
    if not candidates:
        raise AIUnavailable(f'Missing prompt {name}')
    path = candidates[-1]
    return path.read_text(encoding='utf-8'), path.stem.split('.')[-1]


def structured(prompt_name: str, payload: dict, schema: dict, *, max_tokens: int = 700) -> tuple[dict, dict]:
    """Call Claude with a forced tool so the reply is JSON matching `schema`.

    Returns (result, meta). Raises AIUnavailable on any failure.
    """
    if not available():
        raise AIUnavailable('AI not configured')
    system, version = load_prompt(prompt_name)
    body = {
        'model': model(), 'max_tokens': max_tokens, 'system': system,
        'tools': [{'name': 'respond', 'description': 'Return the structured answer.', 'input_schema': schema}],
        'tool_choice': {'type': 'tool', 'name': 'respond'},
        'messages': [{'role': 'user', 'content': json.dumps(payload, ensure_ascii=False)}],
    }
    headers = {'x-api-key': os.environ['ANTHROPIC_API_KEY'].strip(), 'anthropic-version': '2023-06-01', 'content-type': 'application/json'}
    try:
        response = httpx.post(API_URL, headers=headers, json=body, timeout=TIMEOUT)
        response.raise_for_status()
        blocks = response.json().get('content', [])
        result = next(b['input'] for b in blocks if b.get('type') == 'tool_use')
    except (httpx.HTTPError, ValueError, KeyError, StopIteration) as exc:
        raise AIUnavailable(type(exc).__name__) from None
    missing = [k for k in schema.get('required', []) if k not in result]
    if missing:
        raise AIUnavailable(f'AI reply missing {missing}')
    return result, {'model': model(), 'prompt': f'{prompt_name}.{version}'}
