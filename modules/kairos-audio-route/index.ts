import { requireNativeModule } from "expo-modules-core";

// Where the phone's audio currently goes. "unknown" means the native module is
// missing — i.e. the JS bundle is newer than the installed APK, because this
// module needs a native rebuild (`expo prebuild` + assembleRelease) to exist.
export type AudioOutput = "bluetooth" | "wired" | "speaker" | "unknown";

type NativeAudioRoute = { currentOutput(): string };

// Resolve once, tolerate absence. Anti-sèche degrades to asking the user to
// confirm their earpiece rather than crashing or — far worse — assuming a
// private route and talking out loud.
const native: NativeAudioRoute | null = (() => {
  try {
    return requireNativeModule<NativeAudioRoute>("KairosAudioRoute");
  } catch {
    return null;
  }
})();

export function isAvailable(): boolean {
  return native !== null;
}

export function currentOutput(): AudioOutput {
  if (!native) return "unknown";
  try {
    const out = native.currentOutput();
    return out === "bluetooth" || out === "wired" || out === "speaker"
      ? out
      : "unknown";
  } catch {
    return "unknown";
  }
}

// The guard the anti-sèche session gates every utterance on: is this route
// private enough to read a crib sheet into? "unknown" is deliberately NOT
// private — the caller must fall back to an explicit user confirmation.
export function isPrivateOutput(out: AudioOutput = currentOutput()): boolean {
  return out === "bluetooth" || out === "wired";
}
