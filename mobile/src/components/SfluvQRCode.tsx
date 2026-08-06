import React, { useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import QRCode from "react-native-qrcode-svg";
import { Palette, getShadows, radii, useAppTheme } from "../theme";

const SFLUV_LOGO = require("../../assets/icon.png");

/** Dark modules rather than brand coral: contrast is what scanners need. */
const MODULE_COLOR = "#161616";
const FRAME_PADDING = 14;

type Props = {
  value: string;
  /** Fixed size; omit to fill the available width, which is the usual case. */
  size?: number;
};

/**
 * The app's one QR presentation, matching the web wallet's: a white rounded
 * card with a brand-tinted border and the SFLuv mark centred on the code.
 *
 * The mark sits on top of the modules rather than replacing them, so the code
 * is generated at the highest error-correction level to stay readable.
 */
export function SfluvQRCode({ value, size }: Props) {
  const { palette, isDark } = useAppTheme();
  const styles = useMemo(() => createStyles(palette, isDark), [palette, isDark]);
  const [frameWidth, setFrameWidth] = useState(0);

  const resolvedSize = size ?? Math.max(0, Math.floor(frameWidth - FRAME_PADDING * 2));
  const logoSize = Math.round(resolvedSize * 0.2);

  return (
    <View
      style={styles.frame}
      onLayout={(event) => setFrameWidth(event.nativeEvent.layout.width)}
    >
      {resolvedSize > 0 ? (
        <QRCode
          value={value}
          size={resolvedSize}
          color={MODULE_COLOR}
          backgroundColor="#ffffff"
          logo={SFLUV_LOGO}
          logoSize={logoSize}
          logoBackgroundColor="#ffffff"
          logoBorderRadius={Math.round(logoSize / 2)}
          logoMargin={3}
          ecl="H"
          quietZone={6}
        />
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
  });
}
