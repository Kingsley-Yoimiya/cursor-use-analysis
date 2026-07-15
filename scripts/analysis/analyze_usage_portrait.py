#!/usr/bin/env python3
"""生成 Cursor 使用行为画像及可视化数据。"""

from __future__ import annotations

import json
import math
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
import sys

SYS_DIR = Path(__file__).resolve().parent
if str(SYS_DIR) not in sys.path:
    sys.path.insert(0, str(SYS_DIR))

import matplotlib.pyplot as plt
import matplotlib.dates as mdates
import numpy as np
from matplotlib.patches import Rectangle

from plot_style import add_y_grid, apply_plot_style


ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "reports" / "estimate.json"
OUTPUT = ROOT / "reports" / "usage-behavior-portrait.json"
LOCAL_TZ = timezone(timedelta(hours=8))
POOLS = ("API", "FirstParty", "Auto")


def to_local(iso: str) -> datetime:
    return datetime.fromisoformat(iso.replace("Z", "+00:00")).astimezone(LOCAL_TZ)


def all_days(start: date, end: date) -> list[date]:
    return [start + timedelta(days=i) for i in range((end - start).days + 1)]


def gini(values: np.ndarray) -> float:
    values = np.sort(np.asarray(values, dtype=float))
    if len(values) == 0 or values.sum() == 0:
        return 0.0
    index = np.arange(1, len(values) + 1)
    return float((2 * np.sum(index * values) / (len(values) * values.sum())) - (len(values) + 1) / len(values))


def longest_streak(flags: list[bool], days: list[str]) -> dict:
    best_len = cur_len = 0
    best_end = cur_start = None
    best_start = None
    for i, flag in enumerate(flags):
        if flag:
            if cur_len == 0:
                cur_start = i
            cur_len += 1
            if cur_len > best_len:
                best_len = cur_len
                best_start = cur_start
                best_end = i
        else:
            cur_len = 0
    return {
        "days": best_len,
        "start": days[best_start] if best_start is not None else None,
        "end": days[best_end] if best_end is not None else None,
    }


def shannon_metrics(model_tokens: dict[str, int]) -> tuple[float, float, float]:
    values = np.asarray(list(model_tokens.values()), dtype=float)
    values = values[values > 0]
    if values.sum() == 0:
        return 0.0, 0.0, 0.0
    p = values / values.sum()
    entropy = float(-np.sum(p * np.log(p)))
    return entropy, float(math.exp(entropy)), float(np.max(p))


def regime(day: dict, q90: float) -> str:
    total = day["tokens"]
    if total == 0:
        return "沉寂"
    if total >= q90:
        return "爆发"
    api_share = day["pools"]["API"] / total
    first_share = day["pools"]["FirstParty"] / total
    if api_share >= 0.67:
        return "API 主导"
    if first_share >= 0.67:
        return "First-party 主导"
    return "混合"


def draw_calendar(days: list[dict]) -> None:
    apply_plot_style()
    values = np.asarray([d["tokens"] for d in days], dtype=float)
    positive = values[values > 0]
    cuts = np.quantile(positive, [0.25, 0.5, 0.75, 0.9]) if len(positive) else np.zeros(4)
    start = datetime.fromisoformat(days[0]["date"]).date()
    monday = start - timedelta(days=start.weekday())
    fig, ax = plt.subplots(figsize=(16, 5.8))
    cmap = plt.get_cmap("Blues")
    for item in days:
        current = datetime.fromisoformat(item["date"]).date()
        week = (current - monday).days // 7
        weekday = current.weekday()
        value = item["tokens"]
        level = 0 if value == 0 else 1 + int(np.searchsorted(cuts, value, side="right"))
        color = cmap(0.08 + level * 0.17)
        ax.add_patch(Rectangle((week, 6 - weekday), 0.86, 0.86, facecolor=color, edgecolor="white", linewidth=0.8))
    for month in sorted({d["date"][:7] for d in days}):
        first = datetime.fromisoformat(month + "-01").date()
        if first < start:
            first = start
        x = (first - monday).days // 7
        ax.text(x, 7.25, f"{first.month}月", ha="left", va="bottom", fontsize=13)
    ax.set_xlim(-0.5, math.ceil((datetime.fromisoformat(days[-1]["date"]).date() - monday).days / 7) + 1)
    ax.set_ylim(-0.4, 7.8)
    ax.set_yticks(range(7), ["周日", "周六", "周五", "周四", "周三", "周二", "周一"])
    ax.set_xticks([])
    ax.set_title("每日使用强度日历：沉寂、常态与爆发期")
    ax.set_xlabel("本地日历周（UTC+8）")
    for spine in ax.spines.values():
        spine.set_visible(False)
    fig.text(
        0.01,
        0.01,
        "颜色表示每日总 token 的经验分位等级；越深代表当天上下文输入、缓存读取与输出总量越大。"
        "来源：Cursor 用量事件逐条转为 UTC+8 后聚合；仅含 2026-01-03 至 2026-07-14 的完整日。",
        fontsize=10.5,
    )
    fig.subplots_adjust(bottom=0.17, top=0.82)
    fig.savefig(ROOT / "reports" / "usage-calendar.svg")
    plt.close(fig)


def draw_lorenz(values: np.ndarray) -> None:
    apply_plot_style()
    sorted_values = np.sort(values)
    cumulative = np.insert(np.cumsum(sorted_values) / sorted_values.sum(), 0, 0)
    population = np.linspace(0, 1, len(cumulative))
    fig, ax = plt.subplots(figsize=(8.5, 7.2))
    ax.plot(population * 100, cumulative * 100, linewidth=2.8, label="实际累计用量")
    ax.plot([0, 100], [0, 100], linestyle="--", linewidth=1.4, label="每天完全均匀")
    ax.fill_between(population * 100, cumulative * 100, population * 100, alpha=0.12)
    ax.set_title("用量集中度：少数日期贡献多数 token")
    ax.set_xlabel("按用量从低到高排列的日期累计占比（%）")
    ax.set_ylabel("累计 Token 占比（%）")
    add_y_grid(ax)
    ax.legend()
    fig.text(
        0.01,
        0.01,
        "洛伦兹曲线把完整日按总 token 从低到高排列；曲线离对角线越远，说明使用越集中在少数爆发日。"
        "token 来自 Cursor 用量事件四个分项之和，零使用日保留。",
        fontsize=10.5,
    )
    fig.subplots_adjust(bottom=0.18)
    fig.savefig(ROOT / "reports" / "usage-lorenz.svg")
    plt.close(fig)


def draw_hourly(hour_tokens: np.ndarray) -> None:
    apply_plot_style()
    theta = np.linspace(0, 2 * np.pi, 24, endpoint=False)
    width = 2 * np.pi / 24 * 0.82
    fig, ax = plt.subplots(figsize=(8.5, 8.5), subplot_kw={"projection": "polar"})
    bars = ax.bar(theta, hour_tokens / 1e6, width=width, edgecolor="white", linewidth=0.8)
    max_value = max(float(np.max(hour_tokens)), 1.0)
    for bar, value in zip(bars, hour_tokens):
        bar.set_alpha(0.3 + 0.7 * float(value) / max_value)
    ax.set_theta_zero_location("N")
    ax.set_theta_direction(-1)
    ax.set_xticks(theta[::3], [f"{h:02d}:00" for h in range(0, 24, 3)])
    ax.set_title("一天中的使用时钟", pad=28)
    ax.set_ylabel("Token（百万）", labelpad=34)
    fig.text(
        0.01,
        0.01,
        "每根柱表示 UTC+8 对应小时内发生的 token 总量，按请求时间戳归桶；这是半年累计节律，不代表单日连续工作时长。",
        fontsize=10.5,
    )
    fig.subplots_adjust(bottom=0.12, top=0.86)
    fig.savefig(ROOT / "reports" / "usage-clock.svg")
    plt.close(fig)


def draw_monthly(monthly: dict) -> None:
    apply_plot_style()
    months = sorted(monthly)
    api = []
    first = []
    auto = []
    for month in months:
        total = sum(monthly[month].values())
        api.append(monthly[month]["API"] / total * 100 if total else 0)
        first.append(monthly[month]["FirstParty"] / total * 100 if total else 0)
        auto.append(monthly[month]["Auto"] / total * 100 if total else 0)
    fig, ax = plt.subplots(figsize=(11.5, 6.8))
    bottom = np.zeros(len(months))
    for values, label, hatch in ((api, "API", "///"), (first, "First-party", "\\\\\\"), (auto, "Auto", "xx")):
        ax.bar(months, values, bottom=bottom, label=label, hatch=hatch, edgecolor="white", linewidth=0.8)
        bottom += np.asarray(values)
    ax.set_title("模型池接力：每月 Token 构成")
    ax.set_xlabel("月份（UTC+8）")
    ax.set_ylabel("当月 Token 占比（%）")
    add_y_grid(ax)
    ax.legend(ncol=3)
    fig.text(
        0.01,
        0.01,
        "占比的分母为当月全部 token。API / First-party 来自 Model 经 aliases 与 billingPool 分类；"
        "7 月只统计 1–14 日完整日，不能与完整月份直接比较绝对总量。",
        fontsize=10.5,
    )
    fig.subplots_adjust(bottom=0.2)
    fig.savefig(ROOT / "reports" / "monthly-pool-share.svg")
    plt.close(fig)


def main() -> None:
    payload = json.loads(SOURCE.read_text(encoding="utf-8"))
    generated_day = to_local(payload["generatedAt"]).date()
    events = []
    skipped = 0
    for row in payload["rows"]:
        if not row.get("date") or not isinstance(row.get("tokens"), dict):
            skipped += 1
            continue
        local = to_local(row["date"])
        token_parts = {k: int(v or 0) for k, v in row["tokens"].items()}
        events.append(
            {
                "local": local,
                "day": local.date(),
                "hour": local.hour,
                "pool": row["pool"],
                "model": row.get("resolvedRateKey") or row.get("model") or "unknown",
                "tokens": sum(token_parts.values()),
                "parts": token_parts,
                "cost": float(row.get("estimatedUsd", 0) or 0),
            }
        )

    start_day = min(e["day"] for e in events)
    end_day = max(e["day"] for e in events)
    complete_end = min(end_day, generated_day - timedelta(days=1))
    dates = all_days(start_day, complete_end)
    by_day = {
        d: {
            "date": d.isoformat(),
            "tokens": 0,
            "requests": 0,
            "pools": {pool: 0 for pool in POOLS},
            "models": defaultdict(int),
            "cacheRead": 0,
        }
        for d in dates
    }
    hour_tokens = np.zeros(24)
    hour_requests = np.zeros(24)
    pool_parts = {pool: Counter() for pool in POOLS}
    pool_cost = Counter()
    monthly = defaultdict(lambda: Counter({pool: 0 for pool in POOLS}))

    for event in events:
        if event["day"] > complete_end:
            continue
        day = by_day[event["day"]]
        day["tokens"] += event["tokens"]
        day["requests"] += 1
        day["pools"][event["pool"]] += event["tokens"]
        day["models"][event["model"]] += event["tokens"]
        day["cacheRead"] += event["parts"].get("cacheRead", 0)
        hour_tokens[event["hour"]] += event["tokens"]
        hour_requests[event["hour"]] += 1
        pool_parts[event["pool"]].update(event["parts"])
        pool_cost[event["pool"]] += event["cost"]
        monthly[event["day"].strftime("%Y-%m")][event["pool"]] += event["tokens"]

    daily = []
    for d in dates:
        item = by_day[d]
        entropy, effective, dominant_share = shannon_metrics(item["models"])
        dominant_model = max(item["models"], key=item["models"].get) if item["models"] else None
        daily.append(
            {
                "date": item["date"],
                "tokens": item["tokens"],
                "requests": item["requests"],
                "pools": item["pools"],
                "activeModels": len(item["models"]),
                "modelEntropy": entropy,
                "effectiveModels": effective,
                "dominantModel": dominant_model,
                "dominantModelShare": dominant_share,
                "cacheReadShare": item["cacheRead"] / item["tokens"] if item["tokens"] else 0,
            }
        )

    values = np.asarray([d["tokens"] for d in daily], dtype=float)
    total = float(values.sum())
    median = float(np.median(values))
    q90 = float(np.quantile(values, 0.9))
    sorted_desc = np.sort(values)[::-1]
    concentration = {
        f"top{n}DaysShare": float(sorted_desc[:n].sum() / total)
        for n in (1, 5, 10, 20)
    }
    concentration["gini"] = gini(values)
    concentration["daysFor50Pct"] = int(np.searchsorted(np.cumsum(sorted_desc), total * 0.5) + 1)
    concentration["daysFor80Pct"] = int(np.searchsorted(np.cumsum(sorted_desc), total * 0.8) + 1)

    state_counts = Counter()
    transitions = Counter()
    previous = None
    for item in daily:
        item["regime"] = regime(item, q90)
        state_counts[item["regime"]] += 1
        if previous is not None:
            transitions[f"{previous} → {item['regime']}"] += 1
        previous = item["regime"]

    model_totals = Counter()
    for item in by_day.values():
        model_totals.update(item["models"])
    top_models = [
        {"model": model, "tokens": tokens, "share": tokens / total}
        for model, tokens in model_totals.most_common(10)
    ]

    peak_days = []
    for item in sorted(daily, key=lambda x: x["tokens"], reverse=True)[:10]:
        dominant_pool = max(item["pools"], key=item["pools"].get)
        peak_days.append(
            {
                "date": item["date"],
                "tokens": item["tokens"],
                "medianDayMultiples": item["tokens"] / median if median else None,
                "dominantPool": dominant_pool,
                "dominantPoolShare": item["pools"][dominant_pool] / item["tokens"],
                "dominantModel": item["dominantModel"],
                "dominantModelShare": item["dominantModelShare"],
            }
        )

    pool_efficiency = {}
    for pool in POOLS:
        parts = pool_parts[pool]
        tokens = sum(parts.values())
        input_side = parts["cacheWrite"] + parts["noCache"] + parts["cacheRead"]
        pool_efficiency[pool] = {
            "tokens": tokens,
            "cacheReadShareOfInput": parts["cacheRead"] / input_side if input_side else 0,
            "outputShare": parts["output"] / tokens if tokens else 0,
            "estimatedUsdPerMillionTokens": pool_cost[pool] / tokens * 1e6 if tokens else 0,
        }

    active_flags = [v > 0 for v in values]
    active_days = int(np.sum(active_flags))
    active_effective = [d["effectiveModels"] for d in daily if d["tokens"] > 0]
    dominant_shares = [d["dominantModelShare"] for d in daily if d["tokens"] > 0]
    result = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "source": str(SOURCE),
        "timezone": "UTC+8",
        "dateRange": {"start": dates[0].isoformat(), "end": dates[-1].isoformat()},
        "completeDays": len(dates),
        "skippedRows": skipped,
        "headline": {
            "totalTokens": total,
            "medianDailyTokens": median,
            "activeDays": active_days,
            "activeDayRatio": active_days / len(dates),
            "longestActiveStreak": longest_streak(active_flags, [d["date"] for d in daily]),
            "longestZeroStreak": longest_streak([not x for x in active_flags], [d["date"] for d in daily]),
        },
        "concentration": concentration,
        "regimes": {
            "definition": {
                "沉寂": "token = 0",
                "爆发": "token >= 完整日第 90 百分位",
                "API 主导": "非爆发且 API token 占比 >= 67%",
                "First-party 主导": "非爆发且 First-party token 占比 >= 67%",
                "混合": "其余非零日",
            },
            "counts": dict(state_counts),
            "topTransitions": [
                {"transition": key, "count": count}
                for key, count in transitions.most_common(12)
            ],
        },
        "clock": {
            "hourTokens": hour_tokens.tolist(),
            "hourRequests": hour_requests.tolist(),
            "peakTokenHour": int(np.argmax(hour_tokens)),
            "peakRequestHour": int(np.argmax(hour_requests)),
            "lateNightTokenShare00To06": float(hour_tokens[:6].sum() / hour_tokens.sum()),
            "eveningTokenShare18To24": float(hour_tokens[18:].sum() / hour_tokens.sum()),
        },
        "models": {
            "top": top_models,
            "meanEffectiveModelsOnActiveDay": float(np.mean(active_effective)),
            "medianDominantModelShareOnActiveDay": float(np.median(dominant_shares)),
        },
        "poolEfficiency": pool_efficiency,
        "monthlyPoolTokens": {month: dict(counts) for month, counts in sorted(monthly.items())},
        "peakDays": peak_days,
        "daily": daily,
    }
    OUTPUT.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    draw_calendar(daily)
    draw_lorenz(values)
    draw_hourly(hour_tokens)
    draw_monthly(monthly)
    print(json.dumps({"output": str(OUTPUT), "svg": ["usage-calendar.svg", "usage-lorenz.svg", "usage-clock.svg", "monthly-pool-share.svg"]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
