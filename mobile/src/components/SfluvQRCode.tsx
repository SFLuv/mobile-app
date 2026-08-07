import React, { useMemo } from "react";
import { Image, StyleSheet, View } from "react-native";
import Svg, { Circle, Rect } from "react-native-svg";
// The matrix generator the QR library uses internally. Drawing the modules
// ourselves is the only way to match the web wallet, which renders dot modules
// with rounded brand-coloured finder patterns — neither of which the ready-made
// <QRCode> component can express.
import genMatrix from "react-native-qrcode-svg/src/genMatrix";
import { Palette, getShadows, radii, useAppTheme } from "../theme";
import {
  MASK_GRID,
  MASK_ROWS,
  MARK_CENTROID_OFFSET_X,
  MARK_CENTROID_OFFSET_Y,
} from "../lib/qrLogoMask";

const SFLUV_LOGO = require("../../assets/qr-logo.png");

/**
 * Matrix generation is pure and costs real time on first paint, so results are
 * kept for the life of the process. Callers can warm this before a screen is
 * opened so the code is already computed when it appears.
 */
const matrixCache = new Map<string, number[][]>();

export function prewarmQRCode(value: string | null | undefined): void {
  if (!value || matrixCache.has(value)) {
    return;
  }
  try {
    matrixCache.set(value, genMatrix(value, ERROR_CORRECTION));
  } catch {
    // A value we cannot encode simply stays uncached.
  }
}

function buildMatrix(value: string): number[][] {
  const cached = matrixCache.get(value);
  if (cached) {
    return cached;
  }
  try {
    const generated = genMatrix(value, ERROR_CORRECTION);
    matrixCache.set(value, generated);
    return generated;
  } catch {
    return [];
  }
}

/** Matches the web wallet: near-black modules, brand coral eyes. */
const MODULE_COLOR = "#161616";
const EYE_COLOR = "#eb6c6c";
const FRAME_PADDING = 14;
/**
 * Dot radius, in modules. 0.375 is what the web's previous QR library drew
 * (cellSize/2 at 75%); at the old 0.46 the dots are 0.92 of a cell and nearly
 * touch. Keep in sync with the web's frontend/lib/qr-geometry.js.
 */
const DOT_RADIUS = 0.375;
/** Same error-correction level the web uses; the logo stays inside its budget. */
const ERROR_CORRECTION = "M";
/**
 * Logo box width as a share of the code.
 *
 * The mark does not fill its own asset — qr-logo.png carries ~9% transparent
 * padding a side, so only 82.4% of the box is ink. The two constants below let
 * the clearing circle be sized against the INK rather than the box: sizing it
 * against the box and adding a whole module on top, as this used to, left a
 * conspicuous white moat around the mark.
 *
 * Keep in sync with the web's frontend/lib/qr-geometry.js.
 */
const LOGO_RATIO = 0.24;
/**
 * Clear space between the mark's ink and the nearest drawn dot, in modules.
 *
 * The clearing follows the mark's silhouette rather than a circle, so this is a
 * genuine even margin all the way round a letterform, not the radius of a hole
 * wide enough for the mark's widest point. A circle giving the same visual
 * margin removes far more modules.
 */
const LOGO_MOAT = 0.85;
/** Field padding beyond the logo box, as a fraction of the box. */
const FIELD_PAD = 0.4;
/** Quiet zone, in modules. */
const QUIET_MODULES = 2;

/**
 * Distance from every point near the logo to the mark's nearest ink, in mask
 * cells. Built once and kept: it depends only on the baked-in silhouette.
 *
 * Two-pass chamfer, within a couple of percent of true Euclidean — far finer
 * than a moat needs. Mirrors the web's frontend/lib/qr-geometry.js.
 */
let cachedField: { field: Float32Array; span: number; pad: number } | null = null;
function inkDistanceField() {
  if (cachedField) {
    return cachedField;
  }
  const pad = Math.round(MASK_GRID * FIELD_PAD);
  const span = MASK_GRID + pad * 2;
  const field = new Float32Array(span * span).fill(span * 4);
  for (let y = 0; y < MASK_GRID; y += 1) {
    const row = MASK_ROWS[y];
    for (let x = 0; x < MASK_GRID; x += 1) {
      if (row.charCodeAt(x) === 49) {
        field[(y + pad) * span + (x + pad)] = 0;
      }
    }
  }
  const diag = Math.SQRT2;
  const relax = (index: number, from: number, cost: number) => {
    const candidate = field[from] + cost;
    if (candidate < field[index]) {
      field[index] = candidate;
    }
  };
  for (let y = 0; y < span; y += 1) {
    for (let x = 0; x < span; x += 1) {
      const i = y * span + x;
      if (y > 0) relax(i, i - span, 1);
      if (x > 0) relax(i, i - 1, 1);
      if (y > 0 && x > 0) relax(i, i - span - 1, diag);
      if (y > 0 && x < span - 1) relax(i, i - span + 1, diag);
    }
  }
  for (let y = span - 1; y >= 0; y -= 1) {
    for (let x = span - 1; x >= 0; x -= 1) {
      const i = y * span + x;
      if (y < span - 1) relax(i, i + span, 1);
      if (x < span - 1) relax(i, i + 1, 1);
      if (y < span - 1 && x < span - 1) relax(i, i + span + 1, diag);
      if (y < span - 1 && x > 0) relax(i, i + span - 1, diag);
    }
  }
  cachedField = { field, span, pad };
  return cachedField;
}

type Props = {
  value: string;
  /** Fixed size; omit to fill the available width, which is the usual case. */
  size?: number;
};

/** True for the 7x7 finder patterns, which are drawn as shapes not dots. */
function isFinderModule(row: number, col: number, count: number): boolean {
  const inTopLeft = row < 7 && col < 7;
  const inTopRight = row < 7 && col >= count - 7;
  const inBottomLeft = row >= count - 7 && col < 7;
  return inTopLeft || inTopRight || inBottomLeft;
}

export function SfluvQRCode({ value, size }: Props) {
  const { palette, isDark } = useAppTheme();
  const styles = useMemo(() => createStyles(palette, isDark), [palette, isDark]);

  const matrix = useMemo<number[][]>(() => (value ? buildMatrix(value) : []), [value]);

  /**
   * Everything is laid out in module units and scaled by the SVG's viewBox, so
   * the code does not have to wait for a layout pass to learn its pixel size.
   * That round-trip was why a QR faded in a beat after its tab opened.
   */
  const drawing = useMemo(() => {
    const count = matrix.length;
    if (!count) {
      return null;
    }

    const units = count + QUIET_MODULES * 2;
    const origin = QUIET_MODULES;

    const boxSide = units * LOGO_RATIO;
    // Place the mark on its optical centre: the artwork sits high inside its
    // own frame, so centring the frame leaves it visibly above centre.
    const boxLeft = units / 2 - MARK_CENTROID_OFFSET_X * boxSide - boxSide / 2;
    const boxTop = units / 2 - MARK_CENTROID_OFFSET_Y * boxSide - boxSide / 2;
    const { field, span, pad } = inkDistanceField();
    // A dot is dropped when any part of it would reach into the moat, so the
    // clearing never leaves a module sliced in half against the mark.
    const clearance = LOGO_MOAT + DOT_RADIUS;

    const dots: Array<{ key: string; cx: number; cy: number }> = [];
    for (let row = 0; row < count; row += 1) {
      for (let col = 0; col < count; col += 1) {
        if (!matrix[row][col] || isFinderModule(row, col, count)) {
          continue;
        }
        const cx = origin + col + 0.5;
        const cy = origin + row + 0.5;
        const fx = Math.round(((cx - boxLeft) / boxSide) * MASK_GRID) + pad;
        const fy = Math.round(((cy - boxTop) / boxSide) * MASK_GRID) + pad;
        if (fx >= 0 && fy >= 0 && fx < span && fy < span) {
          const distanceInModules = (field[fy * span + fx] / MASK_GRID) * boxSide;
          if (distanceInModules < clearance) {
            continue;
          }
        }
        dots.push({ key: `${row}:${col}`, cx, cy });
      }
    }

    const eyes = [
      { key: "tl", row: 0, col: 0 },
      { key: "tr", row: 0, col: count - 7 },
      { key: "bl", row: count - 7, col: 0 },
    ].map((eye) => ({ key: eye.key, x: origin + eye.col, y: origin + eye.row }));

    return { units, dots, eyes, boxLeft, boxTop, boxSide };
  }, [matrix]);

  const logoPercent = `${LOGO_RATIO * 100}%`;
  const logoLeft = drawing ? `${(drawing.boxLeft / drawing.units) * 100}%` : "0%";
  const logoTop = drawing ? `${(drawing.boxTop / drawing.units) * 100}%` : "0%";

  return (
    <View style={[styles.frame, size ? { width: size + FRAME_PADDING * 2 } : null]}>
      {drawing ? (
        <View style={styles.canvas}>
          <Svg width="100%" height="100%" viewBox={`0 0 ${drawing.units} ${drawing.units}`}>
            {drawing.eyes.map((eye) => (
              <React.Fragment key={eye.key}>
                {/* Outer ring: a rounded square stroked one module wide. */}
                <Rect
                  x={eye.x + 0.5}
                  y={eye.y + 0.5}
                  width={6}
                  height={6}
                  rx={1.75}
                  ry={1.75}
                  fill="none"
                  stroke={EYE_COLOR}
                  strokeWidth={1}
                />
                <Rect
                  x={eye.x + 2}
                  y={eye.y + 2}
                  width={3}
                  height={3}
                  rx={0.9}
                  ry={0.9}
                  fill={EYE_COLOR}
                />
              </React.Fragment>
            ))}
            {drawing.dots.map((dot) => (
              <Circle key={dot.key} cx={dot.cx} cy={dot.cy} r={DOT_RADIUS} fill={MODULE_COLOR} />
            ))}
          </Svg>
          <Image
            source={SFLUV_LOGO}
            style={[styles.logoMark, { width: logoPercent, height: logoPercent, left: logoLeft, top: logoTop }]}
            resizeMode="contain"
          />
        </View>
      ) : null}
    </View>
  );
}

function createStyles(palette: Palette, isDark: boolean) {
  const shadows = getShadows(palette);
  return StyleSheet.create({
    frame: {
      alignSelf: "stretch",
      alignItems: "center",
      justifyContent: "center",
      // Always white regardless of theme — a dark QR card is a QR that does not
      // scan.
      backgroundColor: "#ffffff",
      borderRadius: radii.lg,
      borderWidth: 1,
      borderColor: isDark ? "rgba(235,108,108,0.34)" : "rgba(235,108,108,0.24)",
      padding: FRAME_PADDING,
      ...shadows.soft,
    },
    // No plate behind it: the modules underneath are already cleared, so the
    // mark sits on the card's own white, exactly as it does on the web.
    canvas: {
      width: "100%",
      aspectRatio: 1,
    },
    logoMark: {
      position: "absolute",
    },
  });
}
