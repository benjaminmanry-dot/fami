"""Generate the original Ashen Legionary combat sound set with the stdlib."""

import math
import random
import struct
import wave
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "audio" / "sfx"
SAMPLE_RATE = 48_000


def write_wave(name: str, samples: list[float]) -> None:
    dc = sum(samples) / max(1, len(samples))
    samples = [value - dc for value in samples]
    peak = max(abs(value) for value in samples) or 1.0
    gain = min(0.94 / peak, 1.8)
    pcm = bytearray()
    for value in samples:
        softened = math.tanh(value * gain * 1.15) / math.tanh(1.15)
        pcm.extend(struct.pack("<h", round(max(-1.0, min(1.0, softened)) * 32767)))
    path = OUTPUT / name
    with wave.open(str(path), "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(SAMPLE_RATE)
        output.writeframes(pcm)


def axe_swing() -> list[float]:
    """Short, broad-band axe passage: air first, blade edge second, no whistle."""
    duration = 0.36
    count = round(duration * SAMPLE_RATE)
    noise = random.Random(4103)
    fast = 0.0
    slow = 0.0
    phase = 0.0
    result: list[float] = []
    for index in range(count):
        time = index / SAMPLE_RATE
        progress = time / duration
        source = noise.uniform(-1.0, 1.0)
        fast += (0.24 + progress * 0.18) * (source - fast)
        slow += (0.018 + progress * 0.020) * (source - slow)
        band = fast - slow
        envelope = math.sin(math.pi * progress) ** 1.55
        envelope *= 0.42 + progress * 0.85
        frequency = 165.0 * (1.0 - progress) + 72.0
        phase += math.tau * frequency / SAMPLE_RATE
        body = math.sin(phase) * math.sin(math.pi * progress) ** 2.0
        result.append(band * envelope * 0.78 + body * 0.075)
    return result


def metal_impact(
    duration: float,
    seed: int,
    thud_frequency: float,
    modes: tuple[tuple[float, float, float], ...],
    brightness: float,
) -> list[float]:
    """Layer a dead body impact, a noisy contact, and inharmonic metal modes."""
    count = round(duration * SAMPLE_RATE)
    noise = random.Random(seed)
    low_noise = 0.0
    phases = [0.0 for _ in modes]
    result: list[float] = []
    for index in range(count):
        time = index / SAMPLE_RATE
        source = noise.uniform(-1.0, 1.0)
        low_noise += 0.13 * (source - low_noise)
        crack = (source - low_noise) * math.exp(-time * 72.0) * brightness
        pitch_fall = thud_frequency * (1.0 - min(0.34, time * 1.9))
        thud = math.sin(math.tau * pitch_fall * time) * math.exp(-time * 15.0) * 0.58
        ring = 0.0
        for mode_index, (frequency, decay, gain) in enumerate(modes):
            phases[mode_index] += math.tau * frequency / SAMPLE_RATE
            partial = math.sin(phases[mode_index])
            partial += math.sin(phases[mode_index] * 1.013 + 0.7) * 0.24
            ring += partial * math.exp(-time * decay) * gain
        result.append(crack + thud + ring)
    return result


def mix_at(target: list[float], source: list[float], offset: float, gain: float = 1.0) -> None:
    start = round(offset * SAMPLE_RATE)
    for index, value in enumerate(source):
        if start + index >= len(target):
            break
        target[start + index] += value * gain


def armor_hit() -> list[float]:
    result = [0.0] * round(0.30 * SAMPLE_RATE)
    mix_at(
        result,
        metal_impact(
            0.28,
            5101,
            91.0,
            ((410.0, 18.0, 0.11), (643.0, 24.0, 0.075), (1015.0, 32.0, 0.035)),
            0.64,
        ),
        0.0,
    )
    # A tiny loose-plate answer keeps the hit from sounding like one synth note.
    mix_at(
        result,
        metal_impact(0.12, 5102, 126.0, ((735.0, 34.0, 0.065), (1180.0, 43.0, 0.025)), 0.30),
        0.043,
        0.44,
    )
    return result


def shield_bash() -> list[float]:
    result = [0.0] * round(0.46 * SAMPLE_RATE)
    mix_at(
        result,
        metal_impact(
            0.43,
            6101,
            64.0,
            ((238.0, 10.0, 0.13), (367.0, 13.0, 0.09), (552.0, 18.0, 0.055), (890.0, 28.0, 0.025)),
            0.74,
        ),
        0.0,
    )
    for offset, seed, gain in ((0.052, 6102, 0.34), (0.107, 6103, 0.22)):
        mix_at(
            result,
            metal_impact(0.13, seed, 104.0, ((690.0, 31.0, 0.055), (1120.0, 46.0, 0.022)), 0.24),
            offset,
            gain,
        )
    return result


def death_clatter() -> list[float]:
    duration = 1.12
    result = [0.0] * round(duration * SAMPLE_RATE)
    impacts = (
        (0.00, 0.34, 7201, 88.0, ((330.0, 15.0, 0.08), (515.0, 20.0, 0.055))),
        (0.25, 0.40, 7202, 62.0, ((220.0, 10.0, 0.12), (382.0, 14.0, 0.08), (610.0, 21.0, 0.04))),
        (0.50, 0.48, 7203, 49.0, ((176.0, 8.0, 0.13), (305.0, 12.0, 0.085), (487.0, 18.0, 0.04))),
        (0.79, 0.28, 7204, 72.0, ((455.0, 23.0, 0.055), (760.0, 34.0, 0.025))),
    )
    for offset, length, seed, thud, modes in impacts:
        impact = metal_impact(length, seed, thud, modes, 0.48)
        mix_at(result, impact, offset, 0.78 if offset == 0.0 else 0.64)

    # A short, filtered ground scrape joins the separate armor contacts.
    noise = random.Random(7205)
    low = 0.0
    scrape_start = round(0.38 * SAMPLE_RATE)
    scrape_end = round(0.88 * SAMPLE_RATE)
    for index in range(scrape_start, scrape_end):
        progress = (index - scrape_start) / max(1, scrape_end - scrape_start - 1)
        source = noise.uniform(-1.0, 1.0)
        low += 0.085 * (source - low)
        result[index] += low * math.sin(math.pi * progress) * (1.0 - progress * 0.72) * 0.18
    return result


def main() -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    write_wave("axe_swing.wav", axe_swing())
    write_wave("armor_hit.wav", armor_hit())
    write_wave("shield_bash.wav", shield_bash())
    write_wave("armor_death.wav", death_clatter())
    print(f"COMBAT_SFX_OK files=4 output={OUTPUT}")


if __name__ == "__main__":
    main()
