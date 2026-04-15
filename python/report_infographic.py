"""
Generate 1200×675 infographic PNGs from overnight report data.
Layout: branding bar | price hero + gauges | on-chain metrics | narrative | footer
"""
import io
import logging
import math
from pathlib import Path

log = logging.getLogger(__name__)

# ── Palette ───────────────────────────────────────────────────────────────────
BG      = (10,  12,  18)
SURFACE = (18,  22,  32)
BORDER  = (35,  42,  58)
ORANGE  = (247, 147,  26)
WHITE   = (255, 255, 255)
MUTED   = (100, 115, 140)
EMERALD = ( 52, 211, 153)
ROSE    = (251,  75,  75)
AMBER   = (251, 191,  36)
CYAN    = ( 34, 211, 238)
BLUE    = ( 96, 165, 250)

W, H = 1200, 675


def _font(size: int, bold: bool = False):
    from PIL import ImageFont
    candidates = [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold else
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf" if bold else
        "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
        "/usr/share/fonts/truetype/freefont/FreeSansBold.ttf" if bold else
        "/usr/share/fonts/truetype/freefont/FreeSans.ttf",
    ]
    for path in candidates:
        if Path(path).exists():
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def _pct_color(pct):
    """Return color for a percentile value."""
    if pct is None:
        return MUTED
    if pct >= 85:
        return ROSE
    if pct >= 65:
        return AMBER
    if pct <= 15:
        return EMERALD
    if pct <= 35:
        return CYAN
    return (160, 170, 190)


def _change_color(val):
    if val is None:
        return MUTED
    return EMERALD if val > 0 else ROSE


def _pill(draw, x, y, text, color, font, alpha=180):
    pad_x, pad_y = 8, 3
    bbox = font.getbbox(text)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    draw.rounded_rectangle(
        [x, y, x + tw + pad_x * 2, y + th + pad_y * 2],
        radius=5, fill=(*color, 40), outline=(*color, 120), width=1,
    )
    draw.text((x + pad_x, y + pad_y), text, font=font, fill=color)
    return tw + pad_x * 2


def _metric_bar(draw, x, y, w, h_bar, pct, color):
    """Draw a percentile bar with fill."""
    draw.rounded_rectangle([x, y, x + w, y + h_bar], radius=2, fill=(*BORDER, 180))
    if pct is not None and pct > 0:
        fill_w = max(4, int(w * min(pct / 100, 1.0)))
        draw.rounded_rectangle([x, y, x + fill_w, y + h_bar], radius=2, fill=(*color, 220))


def generate_png(report: dict) -> bytes:
    """Render a 1200×675 report infographic PNG and return bytes."""
    try:
        from PIL import Image, ImageDraw
    except ImportError:
        raise RuntimeError("Pillow not installed")

    img  = Image.new("RGB", (W, H), BG)
    draw = ImageDraw.Draw(img, "RGBA")

    # ── Fonts ─────────────────────────────────────────────────────────────────
    f_tiny  = _font(12)
    f_small = _font(14)
    f_body  = _font(16)
    f_med   = _font(19, bold=True)
    f_large = _font(28, bold=True)
    f_xl    = _font(52, bold=True)
    f_brand = _font(22, bold=True)

    # ── Pull data ─────────────────────────────────────────────────────────────
    date      = report.get("date", "")
    narrative = report.get("narrative", "").strip()
    s         = report.get("structured") or {}
    price_blk = s.get("price", {})
    onchain   = [m for m in s.get("onchain", []) if m.get("value") is not None]
    pricing   = [m for m in s.get("pricing", []) if m.get("value") is not None]
    supply    = [m for m in s.get("supply",  []) if m.get("value") is not None]
    mining    = [m for m in s.get("mining",  []) if m.get("value") is not None]
    etf       = s.get("etf", [])

    price_val   = price_blk.get("value")
    change_1d   = price_blk.get("change_1d")
    change_7d   = price_blk.get("change_7d")
    change_30d  = price_blk.get("change_30d")
    rsi_val     = price_blk.get("rsi")
    vs_200dma   = price_blk.get("vs_200dma_pct")

    # ── Top bar ───────────────────────────────────────────────────────────────
    draw.rectangle([0, 0, W, 52], fill=SURFACE)
    draw.rectangle([0, 51, W, 52], fill=BORDER)

    # Bitcoin logo dot
    draw.ellipse([18, 11, 40, 33], fill=ORANGE)
    draw.text((24, 13), "₿", font=_font(15, bold=True), fill=BG)

    draw.text((50, 12), "ClarionView", font=f_brand, fill=WHITE)
    draw.text((178, 16), "Overnight Report", font=f_small, fill=MUTED)

    # Date right
    if date:
        from datetime import datetime as _dt
        try:
            date_str = _dt.strptime(date, "%Y-%m-%d").strftime("%B %d, %Y")
        except ValueError:
            date_str = date
        bbox = f_body.getbbox(date_str)
        draw.text((W - (bbox[2] - bbox[0]) - 22, 15), date_str, font=f_body, fill=MUTED)

    # ── Left column (price hero) ──────────────────────────────────────────────
    COL1 = 28
    y = 68

    draw.text((COL1, y), "BTC / USD", font=f_small, fill=MUTED)
    y += 20

    price_str = f"${price_val:,.0f}" if price_val else "N/A"
    draw.text((COL1, y), price_str, font=f_xl, fill=ORANGE)
    y += 62

    # Period changes
    for label, val in [("24h", change_1d), ("7d", change_7d), ("30d", change_30d)]:
        if val is None:
            continue
        col = _change_color(val)
        sign = "+" if val > 0 else ""
        draw.text((COL1, y), label, font=f_tiny, fill=MUTED)
        draw.text((COL1 + 28, y), f"{sign}{val:.2f}%", font=f_small, fill=col)
        y += 19

    y += 6

    # RSI gauge arc
    if rsi_val is not None:
        cx, cy, r = COL1 + 88, y + 64, 56
        # Background arc
        draw.arc([cx - r, cy - r, cx + r, cy + r], start=180, end=0, fill=BORDER, width=10)
        # RSI value arc (0-100 → 0-180 deg)
        sweep = int(180 * min(rsi_val / 100, 1.0))
        rsi_col = ROSE if rsi_val >= 70 else EMERALD if rsi_val <= 30 else AMBER
        draw.arc([cx - r, cy - r, cx + r, cy + r], start=180, end=180 + sweep, fill=rsi_col, width=10)
        # Needle
        angle = math.radians(180 - rsi_val * 1.8)
        nx = cx + int((r - 6) * math.cos(angle))
        ny = cy - int((r - 6) * math.sin(angle))
        draw.ellipse([nx - 4, ny - 4, nx + 4, ny + 4], fill=WHITE)

        draw.text((cx - 15, cy - 18), f"{rsi_val:.0f}", font=f_med, fill=rsi_col)
        draw.text((cx - 22, cy + 6), "RSI (14)", font=f_tiny, fill=MUTED)
        y = cy + 36

    # vs 200DMA
    if vs_200dma is not None:
        col = _change_color(vs_200dma)
        sign = "+" if vs_200dma > 0 else ""
        draw.text((COL1, y + 6), "vs 200DMA", font=f_tiny, fill=MUTED)
        draw.text((COL1 + 72, y + 6), f"{sign}{vs_200dma:.1f}%", font=f_small, fill=col)

    # ── Vertical divider ──────────────────────────────────────────────────────
    DIV1 = 270
    draw.rectangle([DIV1, 60, DIV1 + 1, H - 44], fill=BORDER)

    # ── Center column: metrics ────────────────────────────────────────────────
    mx = DIV1 + 20
    my = 66
    mcol_w = 340  # center column width

    def draw_metric_section(title, metrics, x, y, col_w):
        if not metrics:
            return y
        draw.text((x, y), title.upper(), font=f_tiny, fill=(*MUTED, 140))
        y += 16
        bar_h = 5
        row_h = 44
        for m in metrics[:4]:
            pct = m.get("percentile")
            z   = m.get("zscore")
            col = _pct_color(pct)

            draw.text((x, y), m["label"], font=f_small, fill=(200, 210, 225))
            # Value + z-score pill
            val_text = m.get("value_fmt", "N/A")
            vbbox = f_small.getbbox(val_text)
            vw = vbbox[2] - vbbox[0]
            draw.text((x + col_w - vw - (60 if pct is not None else 0), y), val_text, font=f_small, fill=col)

            if pct is not None:
                pct_text = f"{pct:.0f}th"
                _pill(draw, x + col_w - 52, y, pct_text, col, f_tiny)

            y += 18
            _metric_bar(draw, x, y, col_w - 4, bar_h, pct, col)

            if z is not None:
                sign = "+" if z > 0 else ""
                draw.text((x, y + bar_h + 2), f"z = {sign}{z:.2f}σ", font=f_tiny, fill=(*MUTED, 120))

            y += row_h - 18
        return y + 4

    my = draw_metric_section("On-Chain Valuation", onchain[:4], mx, my, mcol_w)
    my = draw_metric_section("Pricing Models", pricing[:3], mx, my, mcol_w)
    my = draw_metric_section("Supply", supply[:3], mx, my, mcol_w)
    my = draw_metric_section("Mining", mining[:2], mx, my, mcol_w)

    # ── Second divider ────────────────────────────────────────────────────────
    DIV2 = DIV1 + mcol_w + 36
    draw.rectangle([DIV2, 60, DIV2 + 1, H - 44], fill=BORDER)

    # ── Right column: ETF + narrative ─────────────────────────────────────────
    rx = DIV2 + 20
    ry = 66
    rw = W - rx - 20

    # ETF mini table
    if etf:
        draw.text((rx, ry), "ETF & EQUITIES", font=f_tiny, fill=(*MUTED, 140))
        ry += 16
        for row in etf[:5]:
            ticker = row["ticker"]
            p1d = row.get("change_1d")
            p30d = row.get("change_30d")
            draw.text((rx, ry), ticker, font=f_small, fill=(200, 210, 225))
            if p1d is not None:
                col = _change_color(p1d)
                sign = "+" if p1d > 0 else ""
                draw.text((rx + 60, ry), f"{sign}{p1d:.1f}%", font=f_small, fill=col)
            if p30d is not None:
                col30 = _change_color(p30d)
                sign30 = "+" if p30d > 0 else ""
                draw.text((rx + 110, ry), f"{sign30}{p30d:.1f}%", font=f_tiny, fill=(*col30, 160))
            ry += 18
        ry += 6

    # Narrative
    if narrative and not narrative.startswith("*LLM narrative unavailable"):
        draw.text((rx, ry), "AI ANALYSIS", font=f_tiny, fill=(*MUTED, 140))
        ry += 16

        # Strip markdown bold markers for clean rendering
        import re
        clean = re.sub(r"\*\*(.+?)\*\*", r"\1", narrative)
        clean = re.sub(r"\*(.+?)\*", r"\1", clean)
        clean = re.sub(r"#+\s*", "", clean)

        max_chars = int(rw / 7)
        words = clean.split()
        lines, line = [], ""
        for w in words:
            test = (line + " " + w).strip()
            if len(test) <= max_chars:
                line = test
            else:
                if line:
                    lines.append(line)
                line = w
            if len(lines) >= 6:
                break
        if line and len(lines) < 6:
            lines.append(line)

        for ln in lines:
            if ry + 20 > H - 50:
                break
            draw.text((rx, ry), ln, font=f_body, fill=(185, 200, 220))
            ry += 22

    # ── Bottom bar ────────────────────────────────────────────────────────────
    draw.rectangle([0, H - 44, W, H], fill=SURFACE)
    draw.rectangle([0, H - 44, W, H - 43], fill=BORDER)
    draw.text((22, H - 27), "clarionview.io  ·  Bitcoin Intelligence", font=f_small, fill=MUTED)

    # Metric count
    total = len(onchain) + len(pricing) + len(supply) + len(mining)
    summary = f"{total} metrics · {len(etf)} ETF instruments"
    bbox = f_small.getbbox(summary)
    draw.text((W - (bbox[2] - bbox[0]) - 22, H - 27), summary, font=f_small, fill=MUTED)

    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=True)
    return buf.getvalue()


def save_infographic(report: dict, out_dir: Path) -> Path:
    date = report.get("date", "unknown")
    out_path = out_dir / f"{date}_report_infographic.png"
    png = generate_png(report)
    out_path.write_bytes(png)
    log.info("Report infographic saved: %s (%d bytes)", out_path.name, len(png))
    return out_path
