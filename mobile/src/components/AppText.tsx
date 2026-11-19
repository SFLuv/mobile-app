import { forwardRef } from "react";
import { I18nManager, Platform, Text as NativeText, type TextProps } from "react-native";

/**
 * React Native's Text, with the writing direction set from the app's layout.
 *
 * iOS decides each piece of text's direction from its first strong character,
 * so in Arabic a line that starts with a number, a name or "SFLUV" (a balance,
 * an email, a wallet name) would sit on the left and order its words left to
 * right. Setting writingDirection from I18nManager makes every line follow the
 * app's direction instead. Android already does this from the layout, and in
 * left-to-right languages nothing changes, so the style is only added on iOS in
 * right-to-left mode, before any style the caller passes (theirs still wins).
 *
 * Imported as `Text` everywhere in place of react-native's.
 */
export const Text = forwardRef<NativeText, TextProps>(function AppText({ style, ...rest }, ref) {
  if (Platform.OS === "ios" && I18nManager.isRTL) {
    // Text with no right-to-left letters (an amount like "+161", an email, a
    // wallet name) keeps its own left-to-right order, so signs and dots stay
    // put, but still sits at the right edge like the Arabic around it.
    const base = hasRtlLetters(rest.children) ? RTL_STYLE : LTR_IN_RTL_STYLE;
    return <NativeText ref={ref} style={[base, style]} {...rest} />;
  }
  return <NativeText ref={ref} style={style} {...rest} />;
});

const RTL_STYLE = { writingDirection: "rtl" } as const;
// "left" is the start edge: React Native swaps left and right in RTL mode, so
// this lands on the right like the Arabic around it.
const LTR_IN_RTL_STYLE = { writingDirection: "ltr", textAlign: "left" } as const;
const RTL_LETTERS = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/;

/** Whether plain children contain Hebrew/Arabic letters. Elements count as yes. */
function hasRtlLetters(children: unknown): boolean {
  if (children === null || children === undefined || typeof children === "boolean") {
    return false;
  }
  if (typeof children === "string") {
    return RTL_LETTERS.test(children);
  }
  if (typeof children === "number") {
    return false;
  }
  if (Array.isArray(children)) {
    return children.some(hasRtlLetters);
  }
  // A nested element (bold run, icon): treat the line as Arabic.
  return true;
}
