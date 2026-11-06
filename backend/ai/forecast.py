"""Crowding forecast: seasonal moving average by weekday and hour.

Method (explainable on stage): for each of the next 6 hours, take the arrivals
recorded in the same weekday-and-hour slot over the previous 8 weeks and average
them. The range shown is the lowest and highest of those 8 values.
"""
from __future__ import annotations

import math
import random
from datetime import datetime, timedelta
from statistics import mean
from zoneinfo import ZoneInfo

TZ = ZoneInfo('Africa/Windhoek')
WEEKS = 8
# Typical hourly shape for a Namibian district/intermediate ED (synthetic).
HOUR_SHAPE = [1.2, 0.9, 0.7, 0.6, 0.6, 0.8, 1.4, 2.4, 3.6, 4.4, 4.8, 4.6, 4.1, 3.8, 3.7, 3.9, 4.2, 4.6, 5.0, 5.1, 4.4, 3.4, 2.4, 1.7]
DAY_FACTOR = [1.15, 1.0, 0.95, 0.95, 1.05, 1.25, 1.2]  # Monday … Sunday (weekend trauma)


def seed_arrivals(end: datetime, seed: int = 2026) -> list[dict]:
    """8 weeks of synthetic hourly arrival counts ending at the hour before `end`."""
    rng = random.Random(seed)
    end = end.astimezone(TZ).replace(minute=0, second=0, microsecond=0)
    start = end - timedelta(weeks=WEEKS)
    rows, t = [], start
    while t < end:
        lam = HOUR_SHAPE[t.hour] * DAY_FACTOR[t.weekday()]
        # Month-end pay-day bump (25th–2nd) on evenings.
        if (t.day >= 25 or t.day <= 2) and 17 <= t.hour <= 23:
            lam *= 1.2
        rows.append({'hour': t.isoformat(), 'arrivals': _poisson(rng, lam)})
        t += timedelta(hours=1)
    return rows


def _poisson(rng, lam):
    limit, k, p = math.exp(-lam), 0, 1.0
    while True:
        p *= rng.random()
        if p <= limit:
            return k
        k += 1


def forecast(history: list[dict], now: datetime, hours: int = 6) -> dict:
    slots: dict[tuple[int, int], list[int]] = {}
    for row in history:
        t = datetime.fromisoformat(row['hour']).astimezone(TZ)
        slots.setdefault((t.weekday(), t.hour), []).append(row['arrivals'])
    start = now.astimezone(TZ).replace(minute=0, second=0, microsecond=0) + timedelta(hours=1)
    points = []
    for i in range(hours):
        t = start + timedelta(hours=i)
        values = slots.get((t.weekday(), t.hour), [])[-WEEKS:]
        points.append({'hour': t.isoformat(), 'label': t.strftime('%H:00'),
                       'expected': round(mean(values), 1) if values else 0.0,
                       'low': min(values) if values else 0, 'high': max(values) if values else 0, 'samples': len(values)})
    return {'label': 'Forecast', 'method': f'Average of the same weekday and hour over the last {WEEKS} weeks (range = lowest to highest).',
            'points': points, 'expected_total': round(sum(p['expected'] for p in points), 1)}


def today_history(history: list[dict], now: datetime) -> list[dict]:
    day = now.astimezone(TZ).date()
    return [r for r in history if datetime.fromisoformat(r['hour']).astimezone(TZ).date() == day]
