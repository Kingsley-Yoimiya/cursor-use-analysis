"""本地分析图统一样式。"""

from __future__ import annotations

import matplotlib.pyplot as plt


def apply_plot_style() -> None:
    plt.rcParams.update(
        {
            "font.family": "sans-serif",
            "font.sans-serif": ["PingFang SC", "Heiti SC", "Arial Unicode MS", "DejaVu Sans"],
            "font.size": 14,
            "axes.titlesize": 18,
            "axes.labelsize": 15,
            "xtick.labelsize": 12,
            "ytick.labelsize": 12,
            "legend.fontsize": 12,
            "figure.titlesize": 20,
            "axes.spines.top": False,
            "axes.spines.right": False,
            "axes.grid": False,
            "savefig.bbox": "tight",
            "svg.fonttype": "none",
        }
    )


def add_y_grid(ax) -> None:
    ax.grid(axis="y", linestyle=":", linewidth=0.9, alpha=0.45)
    ax.set_axisbelow(True)
