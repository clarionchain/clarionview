"""
Generate X.com-ready infographic PNGs from insight data.
Output: 1200×675 landscape (optimal for X/Twitter cards).
"""
import io
import logging
import math
from pathlib import Path

log = logging.getLogger(__name__)

# ── Palette ───────────────────────────────────────────────────────────────────
BG         = (10,  12,  18)       # near-black
SURFACE    = (18,  22,  32)       # card background
BORDER     = (35,  42,  58)       # card border
ORANGE     = (247, 147,  26)      # bitcoin orange
WHITE      = (255, 255, 255)
MUTED      = (120, 130, 150)
EMERALD    = ( 52, 211, 153)
ROSE       = (251,  75,  75)
AMBER      = (251, 191,  36)
CYAN       = ( 34, 211, 238)

LEVEL_COLOR = {"critical": ROSE, "warning": AMBER, "info": CYAN}

W, H = 1200, 675


def _rgb(c): return c  # already tuples


def _font(size: int, bold: bool = False):
    from PIL import ImageFont
    # Try system fonts in order of preference
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


def _rounded_rect(draw, x0, y0, x1, y1, r, fill=None, outline=None, width=1):
    """Draw a rounded rectangle."""
    if fill:
        draw.rounded_rectangle([x0, y0, x1, y1], radius=r, fill=fill, outline=outline, width=width)
    else:
        draw.rounded_rectangle([x0, y0, x1, y1], radius=r, outline=outline, width=width)


def _pill(draw, x, y, text, color, font):
    """Draw a colored pill badge."""
    from PIL import ImageDraw
    pad_x, pad_y = 10, 4
    bbox = font.getbbox(text)
    tw = bbox[2] - bbox[0]
    th = bbox[3] - bbox[1]
    bg = tuple(max(0, c - 180) for c in color) + (180,)  # dark tinted
    px0, py0 = x, y
    px1, py1 = x + tw + pad_x * 2, y + th + pad_y * 2
    draw.rounded_rectangle([px0, py0, px1, py1], radius=6,
                            fill=(*color, 30), outline=(*color, 120), width=1)
    draw.text((px0 + pad_x, py0 + pad_y), text, font=font, fill=color)
    return px1 - px0  # width


def _arc_gauge(draw, cx, cy, r, value, max_val, color, width=10):
    """Draw a semi-circular gauge arc (top half)."""
    from PIL import ImageDraw
    # Background arc
    draw.arc([cx - r, cy - r, cx + r, cy + r], start=180, end=0,
             fill=BORDER, width=width)
    # Value arc
    if max_val > 0:
        sweep = int(180 * min(value / max_val, 1.0))
        draw.arc([cx - r, cy - r, cx + r, cy + r], start=180, end=180 + sweep,
                 fill=color, width=width)


def generate_png(insight: dict) -> bytes:
    """Render insight data to a 1200×675 PNG and return raw bytes."""
    try:
        from PIL import Image, ImageDraw
    except ImportError:
        log.error("Pillow not installed — cannot generate infographic")
        raise

    img  = Image.new("RGB", (W, H), BG)
    draw = ImageDraw.Draw(img, "RGBA")

    # ── Fonts ─────────────────────────────────────────────────────────────────
    f_tiny   = _font(13)
    f_small  = _font(15)
    f_body   = _font(17)
    f_med    = _font(20)
    f_large  = _font(26, bold=True)
    f_xl     = _font(48, bold=True)
    f_brand  = _font(22, bold=True)

    # ── Data ──────────────────────────────────────────────────────────────────
    snapshot = insight.get("snapshot", {})
    changes  = insight.get("changes",  {})
    signals  = insight.get("signals",  [])
    narrative= insight.get("narrative","").strip()
    date     = insight.get("date", "")

    price     = snapshot.get("price")
    mri       = snapshot.get("mri_index")
    mvrv      = snapshot.get("mvrv")
    nupl      = snapshot.get("nupl")

    criticals = [s for s in signals if s["level"] == "critical"]
    warnings  = [s for s in signals if s["level"] == "warning"]
    infos     = [s for s in signals if s["level"] == "info"]

    # ── Top bar ───────────────────────────────────────────────────────────────
    draw.rectangle([0, 0, W, 56], fill=SURFACE)
    draw.rectangle([0, 55, W, 56], fill=BORDER)

    # Bitcoin ₿ dot
    draw.ellipse([20, 12, 44, 36], fill=ORANGE)
    draw.text((26, 14), "₿", font=_font(16, bold=True), fill=BG)

    draw.text((54, 14), "ClarionView", font=f_brand, fill=WHITE)
    draw.text((180, 18), "Bitcoin Intelligence", font=f_small, fill=MUTED)

    # Date right-aligned
    if date:
        from datetime import datetime
        try:
            dt = datetime.strptime(date, "%Y-%m-%d")
            date_str = dt.strftime("%B %d, %Y")
        except ValueError:
            date_str = date
        bbox = f_body.getbbox(date_str)
        draw.text((W - (bbox[2] - bbox[0]) - 24, 17), date_str, font=f_body, fill=MUTED)

    # ── Left column — Price hero ───────────────────────────────────────────────
    col1_x = 32
    y = 80

    draw.text((col1_x, y), "BTC / USD", font=f_small, fill=MUTED)
    y += 22

    if price is not None:
        price_str = f"${price:,.0f}"
    else:
        price_str = "N/A"
    draw.text((col1_x, y), price_str, font=f_xl, fill=ORANGE)
    y += 58

    # Period changes
    for period, days_label in [("1d", "24h"), ("7d", "7d"), ("30d", "30d")]:
        pct = changes.get(period)
        if pct is None:
            continue
        color = EMERALD if pct >= 0 else ROSE
        sign  = "+" if pct >= 0 else ""
        draw.text((col1_x, y), f"{days_label}", font=f_tiny, fill=MUTED)
        draw.text((col1_x + 34, y), f"{sign}{pct:.1f}%", font=f_small, fill=color)
        y += 22

    y += 12

    # ── MRI gauge ─────────────────────────────────────────────────────────────
    if mri is not None:
        gauge_cx, gauge_cy = col1_x + 90, y + 72
        gauge_r = 60
        # Determine color zone
        if mri >= 80:
            g_color = ROSE
            zone = "Euphoria"
        elif mri >= 60:
            g_color = AMBER
            zone = "Overheated"
        elif mri >= 40:
            g_color = ORANGE
            zone = "Bullish"
        elif mri >= 20:
            g_color = CYAN
            zone = "Neutral"
        else:
            g_color = EMERALD
            zone = "Undervalued"

        _arc_gauge(draw, gauge_cx, gauge_cy, gauge_r, mri, 100, g_color, width=12)
        # Needle dot
        angle = math.radians(180 - mri * 1.8)
        nx = gauge_cx + int((gauge_r - 6) * math.cos(angle))
        ny = gauge_cy - int((gauge_r - 6) * math.sin(angle))
        draw.ellipse([nx - 5, ny - 5, nx + 5, ny + 5], fill=WHITE)

        draw.text((gauge_cx - 18, gauge_cy - 22), f"{mri:.0f}", font=f_large, fill=g_color)
        draw.text((gauge_cx - 30, gauge_cy + 6), "MRI Index", font=f_tiny, fill=MUTED)
        draw.text((gauge_cx - len(zone) * 3, gauge_cy + 22), zone, font=f_small, fill=g_color)
        y = gauge_cy + 50

    # ── Divider ───────────────────────────────────────────────────────────────
    div_x = 280
    draw.rectangle([div_x, 68, div_x + 1, H - 60], fill=BORDER)

    # ── Right column — signals + narrative ────────────────────────────────────
    rx = div_x + 24
    ry = 76
    rw = W - rx - 24   # available width

    # Signal counts row
    for label, count, color in [
        ("● CRITICAL", len(criticals), ROSE),
        ("● WARNING",  len(warnings),  AMBER),
        ("● INFO",     len(infos),     CYAN),
    ]:
        if count == 0:
            continue
        draw.text((rx, ry), f"{label}  {count}", font=f_small, fill=color)
        rx += _font(15).getbbox(f"{label}  {count}")[2] + 20
    rx = div_x + 24
    ry += 28

    # Top signals (up to 4)
    top_signals = (criticals + warnings + infos)[:4]
    for sig in top_signals:
        level   = sig["level"]
        color   = LEVEL_COLOR.get(level, CYAN)
        title   = sig["title"]
        body    = sig.get("body", "")

        card_h = 72
        _rounded_rect(draw, rx, ry, rx + rw, ry + card_h, r=8,
                      fill=(*color, 12), outline=(*color, 50), width=1)

        # Left accent bar
        draw.rounded_rectangle([rx + 1, ry + 8, rx + 4, ry + card_h - 8],
                               radius=2, fill=color)

        # Title
        draw.text((rx + 14, ry + 10), title, font=f_med, fill=WHITE)

        # Body (truncated to fit)
        max_chars = int(rw / 8.5)
        body_line = body[:max_chars] + ("…" if len(body) > max_chars else "")
        draw.text((rx + 14, ry + 34), body_line, font=f_small, fill=MUTED)

        # Level pill
        pill_w = _pill(draw, rx + rw - 80, ry + 10, level.upper(), color, f_tiny)

        ry += card_h + 8

    # ── Narrative (bottom strip) ──────────────────────────────────────────────
    if narrative:
        ry += 4
        avail_h = H - 68 - ry
        if avail_h > 36:
            max_chars = int(rw / 7.5)
            lines = []
            words = narrative.split()
            line = ""
            for w in words:
                test = (line + " " + w).strip()
                if len(test) <= max_chars:
                    line = test
                else:
                    if line:
                        lines.append(line)
                    line = w
                if len(lines) >= 2:
                    break
            if line and len(lines) < 2:
                lines.append(line)
            if len(lines) == 2 and len(narrative.split()) > len(" ".join(lines).split()):
                lines[-1] = lines[-1].rstrip() + "…"

            draw.text((rx, ry), "AI Summary", font=f_tiny, fill=MUTED)
            ry += 16
            for ln in lines:
                draw.text((rx, ry), ln, font=f_body, fill=(200, 210, 225))
                ry += 22

    # ── Bottom bar ────────────────────────────────────────────────────────────
    draw.rectangle([0, H - 44, W, H], fill=SURFACE)
    draw.rectangle([0, H - 44, W, H - 43], fill=BORDER)
    draw.text((24, H - 28), "clarionview.io  ·  Bitcoin Intelligence", font=f_small, fill=MUTED)

    # Signal count summary right
    total = len(signals)
    summary = f"{total} signal{'s' if total != 1 else ''} detected"
    bbox = f_small.getbbox(summary)
    draw.text((W - (bbox[2] - bbox[0]) - 24, H - 28), summary, font=f_small, fill=MUTED)

    # ── Export ────────────────────────────────────────────────────────────────
    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=True)
    return buf.getvalue()


def save_infographic(insight: dict, out_dir: Path) -> Path:
    """Generate and save infographic PNG. Returns path."""
    date = insight.get("date", "unknown")
    out_path = out_dir / f"{date}_infographic.png"
    try:
        png_bytes = generate_png(insight)
        out_path.write_bytes(png_bytes)
        log.info("Infographic saved: %s (%d bytes)", out_path.name, len(png_bytes))
    except Exception as e:
        log.error("Infographic generation failed: %s", e)
        raise
    return out_path
