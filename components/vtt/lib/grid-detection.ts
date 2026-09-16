import type { GridCalibration } from "@/lib/room-state";

export type DetectedGrid = {
  columns: number;
  rows: number;
  confidence: number;
  calibration: GridCalibration;
};

export function detectSquareGrid(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): DetectedGrid | null {
  if (width < 80 || height < 80 || pixels.length < width * height * 4) return null;

  const vertical = findPeriod(axisEdges(pixels, width, height, true));
  const horizontal = findPeriod(axisEdges(pixels, width, height, false));
  if (!vertical || !horizontal) return null;

  const periodDifference = Math.abs(vertical.period - horizontal.period);
  const cellPixels = (vertical.period + horizontal.period) / 2;
  const confidence = Math.min(vertical.confidence, horizontal.confidence);
  if (periodDifference / cellPixels > 0.12 || confidence < 0.35) return null;

  const columns = Math.round(width / cellPixels);
  const rows = Math.round(height / cellPixels);
  if (columns < 4 || columns > 100 || rows < 4 || rows > 100) return null;

  return {
    columns,
    rows,
    confidence,
    calibration: {
      offsetX: findOffset(vertical.signal, cellPixels) / width,
      offsetY: findOffset(horizontal.signal, cellPixels) / height,
      cellWidth: cellPixels / width,
      cellHeight: cellPixels / height,
      imageAspect: width / height,
    },
  };
}

function axisEdges(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  vertical: boolean,
): Float64Array {
  const length = vertical ? width : height;
  const crossLength = vertical ? height : width;
  const crossStep = Math.max(1, Math.floor(crossLength / 700));
  const signal = new Float64Array(length);

  for (let position = 2; position < length - 2; position += 1) {
    let total = 0;
    let samples = 0;
    for (let cross = 0; cross < crossLength; cross += crossStep) {
      const x = vertical ? position : cross;
      const y = vertical ? cross : position;
      const center = (y * width + x) * 4;
      const delta = vertical ? 8 : width * 8;
      total += Math.abs(
        luminance(pixels, center) -
          (luminance(pixels, center - delta) + luminance(pixels, center + delta)) / 2,
      );
      samples += 1;
    }
    signal[position] = total / samples;
  }

  return signal;
}

function findPeriod(signal: Float64Array) {
  const minimumCellPixels = 20;
  // ponytail: tiny rendered cells fall back to manual sizing; raise the analysis
  // canvas resolution if 100-column maps regularly render below 20px per cell.
  const maximumCellPixels = Math.floor(signal.length / 4);
  if (maximumCellPixels < minimumCellPixels) return null;

  const mean = signal.reduce((sum, value) => sum + value, 0) / signal.length;
  const centered = Float64Array.from(signal, (value) => value - mean);
  const energy = centered.reduce((sum, value) => sum + value * value, 0) || 1;
  const correlations = new Float64Array(maximumCellPixels + 1);
  let bestLag = 0;
  let bestCorrelation = -1;

  for (let lag = minimumCellPixels; lag <= maximumCellPixels; lag += 1) {
    let product = 0;
    for (let index = 0; index < centered.length - lag; index += 1) {
      const left = centered[index];
      const right = centered[index + lag];
      product += left * right;
    }
    const correlation = product / energy;
    correlations[lag] = correlation;
    if (correlation > bestCorrelation) {
      bestCorrelation = correlation;
      bestLag = lag;
    }
  }

  if (bestLag === 0) return null;
  const before = correlations[bestLag - 1] || bestCorrelation;
  const after = correlations[bestLag + 1] || bestCorrelation;
  const denominator = before - 2 * bestCorrelation + after;
  const adjustment = denominator
    ? clamp(0.5 * (before - after) / denominator, -0.5, 0.5)
    : 0;

  return {
    signal,
    period: bestLag + adjustment,
    confidence: bestCorrelation,
  };
}

function findOffset(signal: Float64Array, period: number): number {
  let bestPhase = 0;
  let bestScore = -1;

  for (let phase = 0; phase < period; phase += 0.5) {
    let total = 0;
    let samples = 0;
    for (let position = phase; position < signal.length; position += period) {
      let peak = 0;
      for (let adjustment = -2; adjustment <= 2; adjustment += 1) {
        peak = Math.max(peak, signal[Math.round(position + adjustment)] ?? 0);
      }
      total += peak;
      samples += 1;
    }
    const score = total / samples;
    if (score > bestScore) {
      bestScore = score;
      bestPhase = phase;
    }
  }

  return bestPhase > period / 2 ? bestPhase - period : bestPhase;
}

function luminance(pixels: Uint8ClampedArray, index: number): number {
  return pixels[index] * 0.2126 + pixels[index + 1] * 0.7152 + pixels[index + 2] * 0.0722;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
