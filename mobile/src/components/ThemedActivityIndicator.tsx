import React from "react";
import { ActivityIndicator, type ActivityIndicatorProps } from "react-native";
import { useAppTheme } from "../theme";

type Props = ActivityIndicatorProps;

export function ThemedActivityIndicator({ color, ...props }: Props) {
  const { mode, palette } = useAppTheme();
  const resolvedColor = color || palette.primaryStrong;

  return <ActivityIndicator key={`${mode}:${String(resolvedColor)}`} color={resolvedColor} {...props} />;
}
