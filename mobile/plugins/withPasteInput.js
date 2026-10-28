/**
 * Wires @mattermost/react-native-paste-input into the iOS AppDelegate.
 *
 * The composer's text field is that library's PasteInput rather than React
 * Native's TextInput, because RN's can only paste text: long-pressing it with a
 * photo or a file on the clipboard offered nothing. PasteInput's own Paste
 * delivers images and files, and the composer stages them like anything picked
 * from the library. On iOS the library has to be handed the root view factory
 * at launch, or it cannot find its views and no paste is ever delivered — and
 * Expo generates the AppDelegate, so the call is inserted here.
 *
 * Expo SDK 54's generated AppDelegate is Swift, with the factory a local in
 * didFinishLaunchingWithOptions; the setup call goes just before that method's
 * return, where `factory` is in scope. Marked, so prebuilding twice does not
 * insert it twice. Android needs nothing: autolinking covers it.
 *
 * That call alone was not enough. The library read the factory's React host
 * once, there, and with expo-updates the host does not exist yet: it is made
 * after launch, once the update to run is chosen. So it found no views and
 * photos still never pasted. patches/@mattermost+react-native-paste-input+
 * 2.0.1.patch keeps the factory and reads its host when a field registers,
 * and keeps rich text pasting as text.
 *
 * ── And the Podfile ─────────────────────────────────────────────────────────
 *
 * The library's podspec refuses to install unless RCT_NEW_ARCH_ENABLED is "1".
 * React Native's use_react_native! sets that — but Expo's Podfile runs
 * use_native_modules! first, and autolinking loads every podspec there, while
 * the variable is still unset. So it is set before autolinking, to the same
 * value use_react_native! would give it a few lines later: "1" unless the new
 * architecture is explicitly off. Nothing else sees anything different.
 */
const { withAppDelegate, withPodfile } = require("expo/config-plugins");

const PODFILE_ANCHOR = "ENV['RCT_NEW_ARCH_ENABLED'] ||= '0' if podfile_properties['newArchEnabled'] == 'false'";
const PODFILE_LINE =
  "ENV['RCT_NEW_ARCH_ENABLED'] ||= '1' if podfile_properties['newArchEnabled'] != 'false' # sfluv: paste input";

// Looked up at runtime rather than imported. A Swift `import` of an
// Objective-C pod needs that pod to define a module, which nothing here
// guarantees, and a missing module map fails the whole iOS build; the class is
// linked regardless (CocoaPods links every Objective-C class with -ObjC), so
// asking for it by name works with no import at all.
const SETUP_LINES = [
  "    // sfluv: paste input",
  '    if let pasteInputModule = NSClassFromString("PasteInputModule") {',
  '      _ = (pasteInputModule as AnyObject).perform(NSSelectorFromString("setup:"), with: factory.rootViewFactory)',
  "    }",
].join("\n");
const SETUP_MARKER = "// sfluv: paste input";
const RETURN_ANCHOR = "    return super.application(application, didFinishLaunchingWithOptions: launchOptions)";

function withNewArchBeforeAutolinking(config) {
  return withPodfile(config, (mod) => {
    let contents = mod.modResults.contents;
    if (!contents.includes(PODFILE_LINE)) {
      if (!contents.includes(PODFILE_ANCHOR)) {
        throw new Error("withPasteInput: could not find the Podfile's new-architecture line.");
      }
      contents = contents.replace(PODFILE_ANCHOR, `${PODFILE_ANCHOR}\n${PODFILE_LINE}`);
    }
    mod.modResults.contents = contents;
    return mod;
  });
}

module.exports = function withPasteInput(config) {
  config = withNewArchBeforeAutolinking(config);
  return withAppDelegate(config, (mod) => {
    if (mod.modResults.language !== "swift") {
      throw new Error("withPasteInput: expected a Swift AppDelegate.");
    }
    let contents = mod.modResults.contents;
    if (!contents.includes(SETUP_MARKER)) {
      if (!contents.includes(RETURN_ANCHOR)) {
        throw new Error("withPasteInput: could not find didFinishLaunchingWithOptions' return.");
      }
      contents = contents.replace(RETURN_ANCHOR, `${SETUP_LINES}\n${RETURN_ANCHOR}`);
    }
    mod.modResults.contents = contents;
    return mod;
  });
};
