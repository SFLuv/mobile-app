import React from "react";
import { StyleProp, StyleSheet, View, ViewStyle } from "react-native";

type Props = {
  size?: number;
  color: string;
  cornerLength?: number;
  thickness?: number;
  radius?: number;
  style?: StyleProp<ViewStyle>;
};

export function ScannerCornerGuide({
  size = 236,
  color,
  cornerLength = 34,
  thickness = 4,
  radius = 18,
  style,
}: Props) {
  const baseCornerStyle = {
    width: cornerLength,
    height: cornerLength,
    borderColor: color,
  };

  return (
    <View
      pointerEvents="none"
      style={[
        styles.frame,
        {
          width: size,
          height: size,
        },
        style,
      ]}
    >
      <View
        style={[
          styles.corner,
          styles.topLeft,
          baseCornerStyle,
          {
            borderTopWidth: thickness,
            borderLeftWidth: thickness,
            borderTopLeftRadius: radius,
          },
        ]}
      />
      <View
        style={[
          styles.corner,
          styles.topRight,
          baseCornerStyle,
          {
            borderTopWidth: thickness,
            borderRightWidth: thickness,
            borderTopRightRadius: radius,
          },
        ]}
      />
      <View
        style={[
          styles.corner,
          styles.bottomLeft,
          baseCornerStyle,
          {
            borderBottomWidth: thickness,
            borderLeftWidth: thickness,
            borderBottomLeftRadius: radius,
          },
        ]}
      />
      <View
        style={[
          styles.corner,
          styles.bottomRight,
          baseCornerStyle,
          {
            borderBottomWidth: thickness,
            borderRightWidth: thickness,
            borderBottomRightRadius: radius,
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    position: "relative",
  },
  corner: {
    position: "absolute",
  },
  topLeft: {
    top: 0,
    left: 0,
  },
  topRight: {
    top: 0,
    right: 0,
  },
  bottomLeft: {
    bottom: 0,
    left: 0,
  },
  bottomRight: {
    bottom: 0,
    right: 0,
  },
});
