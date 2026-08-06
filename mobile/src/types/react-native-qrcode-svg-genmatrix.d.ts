/**
 * The QR library ships no types for its internal matrix generator. We use it
 * directly because the packaged <QRCode> component cannot draw dot modules or
 * brand-coloured finder patterns, which our web wallet's QR styling requires.
 */
declare module "react-native-qrcode-svg/src/genMatrix" {
  const genMatrix: (value: string, errorCorrectionLevel: "L" | "M" | "Q" | "H") => number[][];
  export default genMatrix;
}
