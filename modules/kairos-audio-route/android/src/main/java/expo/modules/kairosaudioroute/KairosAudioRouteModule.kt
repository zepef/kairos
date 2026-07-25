package expo.modules.kairosaudioroute

import android.content.Context
import android.media.AudioDeviceInfo
import android.media.AudioManager
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// Which audio outputs land in the user's ear rather than in the room. This is the
// whole point of the module: expo-speech and expo-audio (SDK 56) expose no output
// route on Android, so without this the anti-sèche cannot tell "read into my
// earpiece" from "announce my crib sheet to the room".
//
// The BLE and USB constants were added in later API levels, but they are compile-
// time `int` literals inlined by kotlinc — referencing them is safe on older
// devices, where simply no connected device ever reports those types.
private val BLUETOOTH_TYPES = setOf(
  AudioDeviceInfo.TYPE_BLUETOOTH_A2DP,
  AudioDeviceInfo.TYPE_BLUETOOTH_SCO,
  AudioDeviceInfo.TYPE_BLE_HEADSET,
)

private val WIRED_TYPES = setOf(
  AudioDeviceInfo.TYPE_WIRED_HEADSET,
  AudioDeviceInfo.TYPE_WIRED_HEADPHONES,
  AudioDeviceInfo.TYPE_USB_HEADSET,
)

class KairosAudioRouteModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("KairosAudioRoute")

    // "bluetooth" | "wired" | "speaker". Synchronous on purpose: the caller polls
    // it right before speaking, and a Promise round-trip there would let an
    // utterance start before the answer came back.
    Function("currentOutput") { currentOutput() }
  }

  private fun currentOutput(): String {
    val am = appContext.reactContext
      ?.getSystemService(Context.AUDIO_SERVICE) as? AudioManager
      ?: return "speaker" // no AudioManager: assume the worst, stay silent
    val types = am.getDevices(AudioManager.GET_DEVICES_OUTPUTS).map { it.type }.toSet()
    // Android routes media to a connected headset automatically, so "a private
    // output is connected" is as close to "the voice goes into the ear" as the
    // platform lets us get without owning the audio session. Bluetooth wins over
    // wired because that is the route Android itself prefers when both are up.
    return when {
      types.any { it in BLUETOOTH_TYPES } -> "bluetooth"
      types.any { it in WIRED_TYPES } -> "wired"
      else -> "speaker"
    }
  }
}
