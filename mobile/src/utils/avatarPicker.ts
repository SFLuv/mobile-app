import * as ImagePicker from "expo-image-picker";

/**
 * Picks a picture for a person or a group: yours, a contact's, a group's.
 *
 * ── Why not allowsEditing ───────────────────────────────────────────────────
 *
 * All three pickers asked for `allowsEditing` to get a square crop, and on iOS
 * that one option makes expo-image-picker fall back from the system photo
 * picker to UIImagePickerController, the pre-iOS 14 one, which loads the
 * library before it draws anything. That was the long pause between tapping
 * a picture and the picker appearing. Without it, the system picker opens
 * straight away, and needs no photo-library permission either, so the
 * permission request that used to come first is gone too.
 *
 * The crop is made here instead: the largest centred square, which is what
 * every round avatar shows of a picture anyway, scaled to 512px. That also
 * keeps it small. The crop editor's output always was, and a full-size photo
 * from a recent iPhone is over the server's 4 MB limit for these pictures.
 *
 * ── A build without the image manipulator ───────────────────────────────────
 *
 * The manipulator is a native module, and an over-the-air update can reach a
 * binary built before it was added. There, importing it throws, so it is
 * loaded defensively and the old cropping picker is used, slow but working.
 */
type ManipulatorModule = typeof import("expo-image-manipulator");
let manipulator: ManipulatorModule | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  manipulator = require("expo-image-manipulator") as ManipulatorModule;
} catch {
  manipulator = null;
}

export type PickedAvatar = { uri: string; mimeType: string; fileName: string };

const AVATAR_SIDE = 512;

/** The chosen picture as a square JPEG, or null if the picker was cancelled. */
export async function pickAvatarPhoto(): Promise<PickedAvatar | null> {
  if (!manipulator) {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.85,
    });
    const asset = result.canceled ? null : result.assets[0];
    return asset
      ? { uri: asset.uri, mimeType: asset.mimeType || "image/jpeg", fileName: asset.fileName || "picture.jpg" }
      : null;
  }

  // quality 1: the picker hands over the original as it is, rather than
  // re-encoding a full-size photo that is about to be cropped and scaled.
  const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 1 });
  const asset = result.canceled ? null : result.assets[0];
  if (!asset) {
    return null;
  }
  return { uri: await squareAvatar(manipulator, asset.uri), mimeType: "image/jpeg", fileName: "picture.jpg" };
}

async function squareAvatar({ ImageManipulator, SaveFormat }: ManipulatorModule, uri: string): Promise<string> {
  // Rendered once untouched for its size: that is the size after the photo's
  // own rotation is applied, which the picker's width and height are not
  // always.
  const original = await ImageManipulator.manipulate(uri).renderAsync();
  const side = Math.min(original.width, original.height);
  const context = ImageManipulator.manipulate(original).crop({
    originX: Math.floor((original.width - side) / 2),
    originY: Math.floor((original.height - side) / 2),
    width: side,
    height: side,
  });
  if (side > AVATAR_SIDE) {
    context.resize({ width: AVATAR_SIDE, height: AVATAR_SIDE });
  }
  const square = await context.renderAsync();
  try {
    const saved = await square.saveAsync({ compress: 0.85, format: SaveFormat.JPEG });
    return saved.uri;
  } finally {
    original.release();
    square.release();
  }
}
