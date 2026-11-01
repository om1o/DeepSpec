"""Small native drawing helpers and accessible palettes."""

from __future__ import annotations

from dataclasses import dataclass

import pygame


@dataclass(frozen=True)
class Palette:
    void: tuple[int, int, int]
    floor: tuple[int, int, int]
    grid: tuple[int, int, int]
    bone: tuple[int, int, int]
    muted: tuple[int, int, int]
    cyan: tuple[int, int, int]
    cyan_soft: tuple[int, int, int]
    amber: tuple[int, int, int]
    magenta: tuple[int, int, int]
    danger: tuple[int, int, int]
    panel: tuple[int, int, int, int]


STANDARD = Palette(
    void=(4, 7, 18),
    floor=(8, 15, 31),
    grid=(24, 38, 58),
    bone=(238, 235, 220),
    muted=(137, 151, 171),
    cyan=(68, 226, 232),
    cyan_soft=(35, 119, 142),
    amber=(255, 184, 76),
    magenta=(224, 61, 138),
    danger=(255, 91, 105),
    panel=(9, 17, 34, 232),
)


HIGH_CONTRAST = Palette(
    void=(0, 0, 0),
    floor=(7, 7, 7),
    grid=(52, 52, 52),
    bone=(255, 255, 255),
    muted=(210, 210, 210),
    cyan=(0, 255, 255),
    cyan_soft=(0, 150, 180),
    amber=(255, 225, 0),
    magenta=(255, 50, 220),
    danger=(255, 50, 50),
    panel=(0, 0, 0, 244),
)


def panel(
    surface: pygame.Surface,
    rect: pygame.Rect,
    palette: Palette,
    *,
    border: tuple[int, int, int] | None = None,
    radius: int = 12,
) -> None:
    pygame.draw.rect(surface, palette.panel, rect, border_radius=radius)
    pygame.draw.rect(surface, border or palette.grid, rect, 2, border_radius=radius)


def centered_text(
    surface: pygame.Surface,
    font: pygame.font.Font,
    text: str,
    color: tuple[int, int, int],
    center: tuple[int, int],
) -> pygame.Rect:
    rendered = font.render(text, True, color)
    rect = rendered.get_rect(center=center)
    surface.blit(rendered, rect)
    return rect


def text(
    surface: pygame.Surface,
    font: pygame.font.Font,
    value: str,
    color: tuple[int, int, int],
    position: tuple[int, int],
    *,
    anchor: str = "topleft",
) -> pygame.Rect:
    rendered = font.render(value, True, color)
    rect = rendered.get_rect()
    setattr(rect, anchor, position)
    surface.blit(rendered, rect)
    return rect


def wrapped_lines(font: pygame.font.Font, value: str, max_width: int) -> list[str]:
    lines: list[str] = []
    for paragraph in value.splitlines() or [""]:
        words = paragraph.split()
        if not words:
            lines.append("")
            continue
        current = words[0]
        for word in words[1:]:
            candidate = f"{current} {word}"
            if font.size(candidate)[0] <= max_width:
                current = candidate
            else:
                lines.append(current)
                current = word
        lines.append(current)
    return lines


def wrapped_text(
    surface: pygame.Surface,
    font: pygame.font.Font,
    value: str,
    color: tuple[int, int, int],
    rect: pygame.Rect,
    *,
    line_spacing: int = 6,
    center: bool = False,
) -> int:
    y = rect.top
    for line in wrapped_lines(font, value, rect.width):
        rendered = font.render(line, True, color)
        target = rendered.get_rect()
        target.midtop = (rect.centerx, y) if center else (rect.left + rendered.get_width() // 2, y)
        surface.blit(rendered, target)
        y += rendered.get_height() + line_spacing
    return y


def meter(
    surface: pygame.Surface,
    rect: pygame.Rect,
    ratio: float,
    fill: tuple[int, int, int],
    background: tuple[int, int, int],
    outline: tuple[int, int, int],
    *,
    radius: int = 5,
) -> None:
    pygame.draw.rect(surface, background, rect, border_radius=radius)
    inner = rect.inflate(-4, -4)
    width = max(0, round(inner.width * max(0.0, min(1.0, ratio))))
    if width:
        pygame.draw.rect(surface, fill, (inner.x, inner.y, width, inner.height), border_radius=max(1, radius - 2))
    pygame.draw.rect(surface, outline, rect, 2, border_radius=radius)


def draw_keycap(
    surface: pygame.Surface,
    font: pygame.font.Font,
    label: str,
    position: tuple[int, int],
    palette: Palette,
) -> pygame.Rect:
    rendered = font.render(label, True, palette.bone)
    rect = rendered.get_rect(topleft=position).inflate(18, 10)
    pygame.draw.rect(surface, palette.floor, rect, border_radius=6)
    pygame.draw.rect(surface, palette.grid, rect, 2, border_radius=6)
    surface.blit(rendered, rendered.get_rect(center=rect.center))
    return rect
