import React, { useMemo, useState } from "react";
import { Image, StyleSheet, View } from "react-native";
import Svg, { Circle, Rect } from "react-native-svg";
// The matrix generator the QR library uses internally. Drawing the modules
// ourselves is the only way to match the web wallet, which renders dot modules
// with rounded brand-coloured finder patterns — neither of which the ready-made
// <QRCode> component can express.
import genMatrix from "react-native-qrcode-svg/src/genMatrix";
import { Palette, getShadows, radii, useAppTheme } from "../theme";

const SFLUV_LOGO = require("../../assets/icon.png");

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
  const [frameWidth, setFrameWidth] = useState(0);

  const resolvedSize = size ?? Math.max(0, Math.floor(frameWidth - FRAME_PADDING * 2));

  const matrix = useMemo<number[][]>(() => {
    if (!value) {
      return [];
    }
    try {
      return genMatrix(value, ERROR_CORRECTION);
    } catch {
      return [];
    }
  }, [value]);

  const drawing = useMemo(() => {
    const count = matrix.length;
    if (!count || resolvedSize <= 0) {
      return null;
    }

    const cell = resolvedSize / (count + QUIET_MODULES * 2);
    const origin = cell * QUIET_MODULES;
    const logoRadius = (resolvedSize * LOGO_RATIO) / 2 + cell;
    const centre = resolvedSize / 2;

    const dots: Array<{ key: string; cx: number; cy: number }> = [];
    for (let row = 0; row < count; row += 1) {
      for (let col = 0; col < count; col += 1) {
        if (!matrix[row][col] || isFinderModule(row, col, count)) {
          continue;
        }
        const cx = origin + (col + 0.5) * cell;
        const cy = origin + (row + 0.5) * cell;
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
    ].map((eye) => ({
      key: eye.key,
      x: origin + eye.col * cell,
      y: origin + eye.row * cell,
    }));

    return { cell, dots, eyes, dotRadius: cell * 0.46 };
  }, [matrix, resolvedSize]);

  const logoSize = Math.round(resolvedSize * LOGO_RATIO);

  return (
    <View style={styles.frame} onLayout={(event) => setFrameWidth(event.nativeEvent.layout.width)}>
      {drawing ? (
        <View>
          <Svg width={resolvedSize} height={resolvedSize}>
            {drawing.eyes.map((eye) => (
              <React.Fragment key={eye.key}>
                {/* Outer ring: a rounded square stroked one module wide. */}
                <Rect
                  x={eye.x + drawing.cell / 2}
                  y={eye.y + drawing.cell / 2}
                  width={drawing.cell * 6}
                  height={drawing.cell * 6}
                  rx={drawing.cell * 1.75}
                  ry={drawing.cell * 1.75}
                  fill="none"
                  stroke={EYE_COLOR}
                  strokeWidth={drawing.cell}
                />
                <Rect
                  x={eye.x + drawing.cell * 2}
                  y={eye.y + drawing.cell * 2}
                  width={drawing.cell * 3}
                  height={drawing.cell * 3}
                  rx={drawing.cell * 0.9}
                  ry={drawing.cell * 0.9}
                  fill={EYE_COLOR}
                />
              </React.Fragment>
            ))}
            {drawing.dots.map((dot) => (
              <Circle key={dot.key} cx={dot.cx} cy={dot.cy} r={drawing.dotRadius} fill={MODULE_COLOR} />
            ))}
          </Svg>
          <View
            style={[
              styles.logoWrap,
              {
                width: logoSize,
                height: logoSize,
                borderRadius: logoSize / 2,
                left: (resolvedSize - logoSize) / 2,
                top: (resolvedSize - logoSize) / 2,
              },
            ]}
          >
            <Image
              source={SFLUV_LOGO}
              style={{ width: logoSize, height: logoSize, borderRadius: logoSize / 2 }}
              resizeMode="cover"
            />
          </View>
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
      borderColor: isDark ? "rgba(239,109,102,0.35)" : "rgba(239,109,102,0.28)",
      padding: FRAME_PADDING,
      ...shadows.soft,
    },
    logoWrap: {
      position: "absolute",
      overflow: "hidden",
      backgroundColor: "#ffffff",
    },
  });
}
