import React, { useMemo } from "react";
import { Image, StyleSheet, View } from "react-native";
import Svg, { Circle, Rect } from "react-native-svg";
// The matrix generator the QR library uses internally. Drawing the modules
// ourselves is the only way to match the web wallet, which renders dot modules
// with rounded brand-coloured finder patterns — neither of which the ready-made
// <QRCode> component can express.
import genMatrix from "react-native-qrcode-svg/src/genMatrix";
import { Palette, getShadows, radii, useAppTheme } from "../theme";

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
/** Same error-correction level the web uses; the logo stays inside its budget. */
const ERROR_CORRECTION = "M";
/** Logo diameter as a share of the code. */
const LOGO_RATIO = 0.2;
/** Quiet zone, in modules. */
const QUIET_MODULES = 2;

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
    const centre = units / 2;
    const logoRadius = (units * LOGO_RATIO) / 2 + 1;

    const dots: Array<{ key: string; cx: number; cy: number }> = [];
    for (let row = 0; row < count; row += 1) {
      for (let col = 0; col < count; col += 1) {
        if (!matrix[row][col] || isFinderModule(row, col, count)) {
          continue;
        }
        const cx = origin + col + 0.5;
        const cy = origin + row + 0.5;
        // Clear the modules the logo covers so it sits on a clean field, the
        // way removeQrCodeBehindLogo does on the web.
        if (Math.hypot(cx - centre, cy - centre) < logoRadius) {
          continue;
        }
        dots.push({ key: `${row}:${col}`, cx, cy });
      }
    }

    const eyes = [
      { key: "tl", row: 0, col: 0 },
      { key: "tr", row: 0, col: count - 7 },
      { key: "bl", row: count - 7, col: 0 },
    ].map((eye) => ({ key: eye.key, x: origin + eye.col, y: origin + eye.row }));

    return { units, dots, eyes };
  }, [matrix]);

  const logoPercent = `${LOGO_RATIO * 100}%`;
  const logoOffset = `${(1 - LOGO_RATIO) * 50}%`;

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
              <Circle key={dot.key} cx={dot.cx} cy={dot.cy} r={0.46} fill={MODULE_COLOR} />
            ))}
          </Svg>
          <Image
            source={SFLUV_LOGO}
            style={[styles.logoMark, { width: logoPercent, height: logoPercent, left: logoOffset, top: logoOffset }]}
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
