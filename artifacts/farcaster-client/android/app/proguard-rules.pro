# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# ── Reflection-dependent code that R8 must not rename/strip ──────────────────
# Capacitor's bridge dispatches plugin calls from JS by reflecting on
# @CapacitorPlugin-annotated classes and their @PluginMethod methods — if R8
# renamed or stripped these, plugin calls from the web bundle would silently
# fail at runtime with no compile-time warning. Capacitor's own AAR ships
# consumer ProGuard rules that cover its own built-in plugins already; these
# rules are a backstop covering the same pattern for any plugin class in this
# app (including future custom ones), so shrinking never depends on Capacitor
# having remembered to bundle a rule for every case.
-keep @com.getcapacitor.annotation.CapacitorPlugin class * {
    @com.getcapacitor.annotation.PermissionCallback <methods>;
}
-keepclassmembers class * extends com.getcapacitor.Plugin {
    @com.getcapacitor.PluginMethod <methods>;
}

# Any class exposed to the WebView via addJavascriptInterface (Capacitor's own
# bridge registers one internally) needs its @JavascriptInterface methods kept
# — R8 renaming these breaks the JS-to-native call by name at runtime.
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# Standard Android framework keep rules R8's default config already covers
# (Parcelable CREATOR fields, enum valueOf/values, view constructors used from
# XML, Serializable) — kept here explicitly rather than relying only on the
# implicit default, since this project enables minification on both build
# types (see build.gradle) rather than just the usual release-only path.
-keepclassmembers class * implements android.os.Parcelable {
    public static final ** CREATOR;
}
-keepclassmembers enum * {
    public static **[] values();
    public static ** valueOf(java.lang.String);
}
-keep public class * extends android.view.View {
    public <init>(android.content.Context);
    public <init>(android.content.Context, android.util.AttributeSet);
}

# Preserve line numbers in stack traces (useful for crash reports) without
# keeping the real source file name, which would otherwise leak the original
# package layout in a decompiled build.
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile
