import { Haptics, ImpactStyle, NotificationType } from "@capacitor/haptics";
import { isNativeRuntime } from "./miniapp-native";

/**
 * Thin, no-op-on-web wrapper around Capacitor Haptics. Every call is gated on
 * isNativeRuntime() - on the plain website or PWA this is a silent no-op, so
 * wiring it into shared components can't change any behavior there. Only the
 * installed native app (which already has this plugin bundled) feels it.
 */
function safe(fn: () => Promise<void>) {
  if (!isNativeRuntime()) return;
  fn().catch(() => { /* haptics are a nicety, never worth surfacing an error for */ });
}

/** Light tap - like, recast toggle, tab switches. */
export function hapticTap() {
  safe(() => Haptics.impact({ style: ImpactStyle.Light }));
}

/** Slightly firmer tap - primary button presses (cast, buy, confirm). */
export function hapticPress() {
  safe(() => Haptics.impact({ style: ImpactStyle.Medium }));
}

/** Success feedback - cast published, purchase confirmed. */
export function hapticSuccess() {
  safe(() => Haptics.notification({ type: NotificationType.Success }));
}

/** Error feedback - transaction failed, action rejected. */
export function hapticError() {
  safe(() => Haptics.notification({ type: NotificationType.Error }));
}
