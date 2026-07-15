#!/usr/bin/env python3
"""按本地日历日分析 Cursor API / First-party 用量时间序列。"""

from __future__ import annotations

import csv
import json
import math
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
import sys

SYS_DIR = Path(__file__).resolve().parent
if str(SYS_DIR) not in sys.path:
    sys.path.insert(0, str(SYS_DIR))

import matplotlib.dates as mdates
import matplotlib.pyplot as plt
import numpy as np

from plot_style import add_y_grid, apply_plot_style


ROOT = Path(__file__).resolve().parents[2]
ESTIMATE_PATH = ROOT / "reports" / "estimate.json"
OUT_JSON = ROOT / "reports" / "daily-usage-statistics.json"
OUT_CSV = ROOT / "reports" / "daily-pool-changes.csv"
LOCAL_TZ = timezone(timedelta(hours=8))
POOLS = ("API", "FirstParty", "Auto")
WEEKDAY_ZH = ("周一", "周二", "周三", "周四", "周五", "周六", "周日")


def local_day(iso: str) -> str:
    return datetime.fromisoformat(iso.replace("Z", "+00:00")).astimezone(LOCAL_TZ).date().isoformat()


def date_range(start: str, end: str) -> list[str]:
    cur = datetime.fromisoformat(start).date()
    stop = datetime.fromisoformat(end).date()
    days = []
    while cur <= stop:
        days.append(cur.isoformat())
        cur += timedelta(days=1)
    return days


def rolling_median(values: np.ndarray, width: int = 7) -> np.ndarray:
    out = np.empty_like(values, dtype=float)
    radius = width // 2
    for i in range(len(values)):
        out[i] = np.median(values[max(0, i - radius) : min(len(values), i + radius + 1)])
    return out


def design_matrix(indices: np.ndarray, weekdays: np.ndarray) -> np.ndarray:
    scale = max(float(indices.max(initial=1)), 1.0)
    cols = [np.ones(len(indices)), indices / scale]
    cols.extend((weekdays == weekday).astype(float) for weekday in range(1, 7))
    return np.column_stack(cols)


def fit_trend_weekday(values: np.ndarray, weekdays: np.ndarray) -> dict:
    indices = np.arange(len(values), dtype=float)
    x = design_matrix(indices, weekdays)
    z = np.log1p(values)
    beta, *_ = np.linalg.lstsq(x, z, rcond=None)
    pred_log = np.sum(x * beta, axis=1)
    pred = np.maximum(0.0, np.expm1(pred_log))
    ss_res = float(np.sum((z - pred_log) ** 2))
    ss_tot = float(np.sum((z - np.mean(z)) ** 2))
    r2 = 1.0 - ss_res / ss_tot if ss_tot else 0.0
    daily_growth = math.expm1(float(beta[1]) / max(len(values) - 1, 1))
    return {
        "beta": beta,
        "prediction": pred,
        "residual_log": z - pred_log,
        "r2Log": r2,
        "trendPctPerDay": daily_growth * 100,
    }


def expanding_cv(values: np.ndarray, weekdays: np.ndarray, min_train: int = 28) -> dict:
    errors_model, errors_prev, errors_week = [], [], []
    for i in range(min_train, len(values)):
        train_idx = np.arange(i, dtype=float)
        train_x = design_matrix(train_idx, weekdays[:i])
        beta, *_ = np.linalg.lstsq(train_x, np.log1p(values[:i]), rcond=None)
        # 设计矩阵的时间缩放必须沿用训练集。
        scale = max(float(i - 1), 1.0)
        row = [1.0, i / scale] + [float(weekdays[i] == weekday) for weekday in range(1, 7)]
        pred = max(0.0, math.expm1(float(np.asarray(row) @ beta)))
        errors_model.append(abs(values[i] - pred))
        errors_prev.append(abs(values[i] - values[i - 1]))
        errors_week.append(abs(values[i] - values[i - 7]))
    return {
        "nPredictions": len(errors_model),
        "maeModel": float(np.mean(errors_model)) if errors_model else None,
        "maePreviousDay": float(np.mean(errors_prev)) if errors_prev else None,
        "maePreviousWeek": float(np.mean(errors_week)) if errors_week else None,
    }


def skewness(values: np.ndarray) -> float:
    std = float(np.std(values))
    return float(np.mean(((values - np.mean(values)) / std) ** 3)) if std else 0.0


def ks_distance(values: np.ndarray, cdf) -> float | None:
    x = np.sort(values)
    if len(x) < 2:
        return None
    fitted = np.asarray([cdf(float(v)) for v in x])
    upper = np.arange(1, len(x) + 1) / len(x)
    lower = np.arange(0, len(x)) / len(x)
    return float(max(np.max(np.abs(upper - fitted)), np.max(np.abs(lower - fitted))))


def distribution_comparison(values: np.ndarray) -> dict:
    positive = values[values > 0]
    if len(positive) < 2:
        return {"positiveDays": int(len(positive)), "normalKs": None, "lognormalKs": None}
    mean, std = float(np.mean(positive)), float(np.std(positive))
    logs = np.log(positive)
    log_mean, log_std = float(np.mean(logs)), float(np.std(logs))
    root2 = math.sqrt(2)

    def normal_cdf(v: float) -> float:
        if std == 0:
            return float(v >= mean)
        return 0.5 * (1 + math.erf((v - mean) / (std * root2)))

    def lognormal_cdf(v: float) -> float:
        if v <= 0:
            return 0.0
        if log_std == 0:
            return float(math.log(v) >= log_mean)
        return 0.5 * (1 + math.erf((math.log(v) - log_mean) / (log_std * root2)))

    return {
        "positiveDays": int(len(positive)),
        "normalKs": ks_distance(positive, normal_cdf),
        "lognormalKs": ks_distance(positive, lognormal_cdf),
        "lognormalMu": log_mean,
        "lognormalSigma": log_std,
    }


def safe_corr(a: np.ndarray, b: np.ndarray) -> float | None:
    if len(a) < 2 or np.std(a) == 0 or np.std(b) == 0:
        return None
    return float(np.corrcoef(a, b)[0, 1])


def window_change(values: np.ndarray, width: int) -> dict:
    current = values[-width:]
    previous = values[-2 * width : -width]
    current_total = float(np.sum(current))
    previous_total = float(np.sum(previous))
    return {
        "windowDays": width,
        "currentTotalTokens": current_total,
        "previousTotalTokens": previous_total,
        "absoluteChangeTokens": current_total - previous_total,
        "percentChange": (current_total / previous_total - 1) if previous_total else None,
        "currentDailyMeanTokens": float(np.mean(current)),
        "previousDailyMeanTokens": float(np.mean(previous)),
    }


def series_summary(values: np.ndarray, weekdays: np.ndarray, dates: list[str]) -> tuple[dict, dict]:
    fit = fit_trend_weekday(values, weekdays)
    median = float(np.median(values))
    mad = float(np.median(np.abs(values - median)))
    residual = fit["residual_log"]
    residual_median = float(np.median(residual))
    residual_mad = float(np.median(np.abs(residual - residual_median)))
    robust_z = (
        0.6745 * (residual - residual_median) / residual_mad
        if residual_mad
        else np.zeros_like(residual)
    )
    anomaly_idx = np.argsort(np.abs(robust_z))[::-1][:8]
    weekday_medians = [
        float(np.median(values[weekdays == weekday])) if np.any(weekdays == weekday) else 0.0
        for weekday in range(7)
    ]
    summary = {
        "days": len(values),
        "meanTokens": float(np.mean(values)),
        "medianTokens": median,
        "q25Tokens": float(np.quantile(values, 0.25)),
        "q75Tokens": float(np.quantile(values, 0.75)),
        "stdTokens": float(np.std(values)),
        "coefficientOfVariation": float(np.std(values) / np.mean(values)) if np.mean(values) else None,
        "skewness": skewness(values),
        "zeroDayRatio": float(np.mean(values == 0)),
        "firstPositiveDate": next((date for date, value in zip(dates, values) if value > 0), None),
        "lag1Correlation": safe_corr(values[1:], values[:-1]),
        "lag7Correlation": safe_corr(values[7:], values[:-7]),
        "weekdayMedianTokens": dict(zip(WEEKDAY_ZH, weekday_medians)),
        "fit": {
            "model": "log1p(tokens) ~ linear time trend + weekday categorical effects",
            "r2Log": fit["r2Log"],
            "trendPctPerDay": fit["trendPctPerDay"],
            "crossValidation": expanding_cv(values, weekdays),
        },
        "distribution": distribution_comparison(values),
        "recentChanges": {
            "latestCompleteDay": {
                "date": dates[-1],
                "tokens": float(values[-1]),
                "absoluteChangeTokens": float(values[-1] - values[-2]),
                "percentChange": float(values[-1] / values[-2] - 1) if values[-2] else None,
            },
            "last7DaysVsPrevious7": window_change(values, 7),
            "last30DaysVsPrevious30": window_change(values, 30),
        },
        "anomalies": [
            {
                "date": dates[int(i)],
                "tokens": float(values[int(i)]),
                "fittedTokens": float(fit["prediction"][int(i)]),
                "robustResidualZ": float(robust_z[int(i)]),
            }
            for i in anomaly_idx
        ],
    }
    arrays = {
        "prediction": fit["prediction"],
        "rollingMedian": rolling_median(values),
        "robustResidualZ": robust_z,
    }
    return summary, arrays


def plot_results(days: list[str], complete_count: int, series: dict, fits: dict, summary: dict) -> None:
    apply_plot_style()
    x = np.asarray([datetime.fromisoformat(day) for day in days])
    complete_x = x[:complete_count]
    api = series["API"] / 1e6
    first = series["FirstParty"] / 1e6
    total = series["Total"] / 1e6

    fig, ax = plt.subplots(figsize=(15, 7.5))
    ax.plot(x, api, linewidth=1.4, alpha=0.55, label="API 每日 token")
    ax.plot(x, first, linewidth=1.4, alpha=0.55, label="First-party 每日 token")
    ax.plot(
        complete_x,
        fits["API"]["rollingMedian"] / 1e6,
        linewidth=2.8,
        label="API 7 日移动中位数",
    )
    ax.plot(
        complete_x,
        fits["FirstParty"]["rollingMedian"] / 1e6,
        linewidth=2.8,
        label="First-party 7 日移动中位数",
    )
    ax.set_title("API 与 First-party 每日使用量及平滑趋势")
    ax.set_xlabel("本地日历日（UTC+8）")
    ax.set_ylabel("Token（百万）")
    add_y_grid(ax)
    ax.legend(ncol=2)
    ax.xaxis.set_major_locator(mdates.MonthLocator())
    ax.xaxis.set_major_formatter(mdates.DateFormatter("%Y-%m"))
    fig.text(
        0.01,
        0.01,
        "每日 token 表示当天各请求输入、缓存读取与输出 token 之和。来源：Cursor 用量导出 → estimate.json 的 pool 分类；"
        "时间戳由 UTC 转为 UTC+8。粗线为 7 日移动中位数；末日若未结束仅展示、不进入拟合。",
        fontsize=10.5,
    )
    fig.subplots_adjust(bottom=0.18)
    fig.savefig(ROOT / "reports" / "daily-pool-usage.svg")
    plt.close(fig)

    delta_api = np.diff(api[:complete_count], prepend=np.nan)
    delta_first = np.diff(first[:complete_count], prepend=np.nan)
    fig, ax = plt.subplots(figsize=(15, 7.5))
    ax.axhline(0, color="0.45", linewidth=1)
    ax.plot(complete_x[1:], delta_api[1:], linewidth=1.5, label="API 较前一日变化")
    ax.plot(complete_x[1:], delta_first[1:], linewidth=1.5, label="First-party 较前一日变化")
    ax.set_title("API 与 First-party 每日使用变化量")
    ax.set_xlabel("本地日历日（UTC+8）")
    ax.set_ylabel("较前一日 Token 变化（百万）")
    add_y_grid(ax)
    ax.legend()
    ax.xaxis.set_major_locator(mdates.MonthLocator())
    ax.xaxis.set_major_formatter(mdates.DateFormatter("%Y-%m"))
    fig.text(
        0.01,
        0.01,
        "变化量 = 当日 token − 前一日 token；正值表示用量增加，负值表示减少。底层数据来自 Cursor 用量事件的模型费率映射："
        "Composer/Grok 4.5 等归 First-party，其余指定模型归 API；Auto 单独保留，未混入两条线。",
        fontsize=10.5,
    )
    fig.subplots_adjust(bottom=0.18)
    fig.savefig(ROOT / "reports" / "daily-pool-changes.svg")
    plt.close(fig)

    fig, ax = plt.subplots(figsize=(15, 7.5))
    ax.plot(complete_x, total[:complete_count], linewidth=1.2, alpha=0.45, label="每日总 token")
    ax.plot(
        complete_x,
        fits["Total"]["prediction"][:complete_count] / 1e6,
        linewidth=2.5,
        label="时间趋势 + 星期效应拟合",
    )
    ax.plot(
        complete_x,
        fits["Total"]["rollingMedian"][:complete_count] / 1e6,
        linewidth=2.5,
        linestyle="--",
        label="7 日移动中位数",
    )
    ax.set_title("每日总用量的可解释拟合")
    ax.set_xlabel("本地日历日（UTC+8）")
    ax.set_ylabel("Token（百万）")
    add_y_grid(ax)
    ax.legend()
    ax.xaxis.set_major_locator(mdates.MonthLocator())
    ax.xaxis.set_major_formatter(mdates.DateFormatter("%Y-%m"))
    fig.text(
        0.01,
        0.01,
        "拟合算子：log1p(每日 token) = 线性时间项 + 星期类别项；用于分离长期变化与 7 天节律。"
        "虚线是稳健的局部描述，不用于外推。拟合只使用完整日，异常峰值保留在原始曲线中。",
        fontsize=10.5,
    )
    fig.subplots_adjust(bottom=0.18)
    fig.savefig(ROOT / "reports" / "daily-total-fit.svg")
    plt.close(fig)

    weekday_values = summary["series"]["Total"]["weekdayMedianTokens"]
    fig, ax = plt.subplots(figsize=(11, 6.5))
    bars = ax.bar(
        list(weekday_values),
        np.asarray(list(weekday_values.values())) / 1e6,
        edgecolor="0.25",
        linewidth=0.8,
    )
    for bar, hatch in zip(bars, ("///", "\\\\\\", "xx", "..", "++", "oo", "**")):
        bar.set_hatch(hatch)
    ax.set_title("不同星期的典型每日总用量")
    ax.set_xlabel("星期（UTC+8）")
    ax.set_ylabel("每日 Token 中位数（百万）")
    add_y_grid(ax)
    fig.text(
        0.01,
        0.01,
        "柱高为各星期每日总 token 的中位数，用于描述一周内的典型节律；中位数可降低少数批量任务峰值的影响。"
        "来源：Cursor 用量事件按 UTC+8 日历日聚合，仅统计完整日。",
        fontsize=10.5,
    )
    fig.subplots_adjust(bottom=0.22)
    fig.savefig(ROOT / "reports" / "weekday-usage.svg")
    plt.close(fig)


def main() -> None:
    payload = json.loads(ESTIMATE_PATH.read_text(encoding="utf-8"))
    rows = payload["rows"]
    by_day = defaultdict(
        lambda: {
            pool: {"tokens": 0, "cost": 0.0, "requests": 0}
            for pool in POOLS
        }
    )
    skipped_rows = 0
    for row in rows:
        if not row.get("date") or not isinstance(row.get("tokens"), dict):
            skipped_rows += 1
            continue
        day = local_day(row["date"])
        pool = row.get("pool", "API")
        if pool not in POOLS:
            pool = "API"
        tokens = sum(int(v or 0) for v in row["tokens"].values())
        by_day[day][pool]["tokens"] += tokens
        by_day[day][pool]["cost"] += float(row.get("estimatedUsd", 0) or 0)
        by_day[day][pool]["requests"] += 1

    days = date_range(min(by_day), max(by_day))
    generated_local_day = local_day(payload["generatedAt"])
    last_day_partial = days[-1] == generated_local_day
    complete_count = len(days) - 1 if last_day_partial else len(days)
    complete_days = days[:complete_count]
    weekdays = np.asarray([datetime.fromisoformat(day).weekday() for day in complete_days], dtype=int)

    daily_records = []
    for day in days:
        record = {"date": day, "isPartial": last_day_partial and day == days[-1], "pools": {}}
        for pool in POOLS:
            record["pools"][pool] = dict(by_day[day][pool])
        daily_records.append(record)

    series = {}
    for pool in POOLS:
        series[pool] = np.asarray([by_day[day][pool]["tokens"] for day in days], dtype=float)
    series["Total"] = sum((series[pool] for pool in POOLS), np.zeros(len(days)))

    summaries, fits = {}, {}
    for name in ("Total", "API", "FirstParty", "Auto"):
        summaries[name], fits[name] = series_summary(
            series[name][:complete_count], weekdays, complete_days
        )

    api_complete = series["API"][:complete_count]
    first_complete = series["FirstParty"][:complete_count]
    api_delta = np.diff(api_complete)
    first_delta = np.diff(first_complete)
    lag_correlations = {}
    for lag in range(-7, 8):
        if lag < 0:
            a, b = api_complete[-lag:], first_complete[:lag]
        elif lag > 0:
            a, b = api_complete[:-lag], first_complete[lag:]
        else:
            a, b = api_complete, first_complete
        lag_correlations[str(lag)] = safe_corr(a, b)
    finite_lags = {k: v for k, v in lag_correlations.items() if v is not None}
    best_lag = max(finite_lags, key=lambda k: abs(finite_lags[k])) if finite_lags else None

    result = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "source": str(ESTIMATE_PATH),
        "aggregationTimezone": "UTC+8",
        "dateRange": {"start": days[0], "end": days[-1]},
        "observedDays": len(days),
        "completeDays": complete_count,
        "lastDayPartial": last_day_partial,
        "skippedRowsWithoutDatedTokenDetail": skipped_rows,
        "series": summaries,
        "apiVsFirstParty": {
            "levelCorrelation": safe_corr(api_complete, first_complete),
            "dailyChangeCorrelation": safe_corr(api_delta, first_delta),
            "lagDefinition": "lag>0 表示 First-party 相对 API 滞后 lag 天",
            "lagCorrelationsMinus7To7": lag_correlations,
            "strongestAbsoluteCorrelationLag": int(best_lag) if best_lag is not None else None,
        },
        "daily": daily_records,
    }
    OUT_JSON.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    with OUT_CSV.open("w", encoding="utf-8", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(
            [
                "date",
                "is_partial",
                "api_tokens",
                "api_delta_tokens",
                "api_pct_change",
                "first_party_tokens",
                "first_party_delta_tokens",
                "first_party_pct_change",
            ]
        )
        for i, day in enumerate(days):
            api_now, first_now = series["API"][i], series["FirstParty"][i]
            if i == 0:
                api_d = first_d = api_pct = first_pct = ""
            else:
                api_d = int(api_now - series["API"][i - 1])
                first_d = int(first_now - series["FirstParty"][i - 1])
                api_prev, first_prev = series["API"][i - 1], series["FirstParty"][i - 1]
                api_pct = (api_now / api_prev - 1) if api_prev else ""
                first_pct = (first_now / first_prev - 1) if first_prev else ""
            writer.writerow(
                [
                    day,
                    str(last_day_partial and i == len(days) - 1).lower(),
                    int(api_now),
                    api_d,
                    api_pct,
                    int(first_now),
                    first_d,
                    first_pct,
                ]
            )

    plot_results(days, complete_count, series, fits, result)
    print(
        json.dumps(
            {
                "dateRange": result["dateRange"],
                "completeDays": complete_count,
                "lastDayPartial": last_day_partial,
                "outputs": [
                    str(OUT_JSON),
                    str(OUT_CSV),
                    str(ROOT / "reports" / "daily-pool-usage.svg"),
                    str(ROOT / "reports" / "daily-pool-changes.svg"),
                    str(ROOT / "reports" / "daily-total-fit.svg"),
                    str(ROOT / "reports" / "weekday-usage.svg"),
                ],
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
