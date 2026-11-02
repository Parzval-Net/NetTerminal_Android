#!/usr/bin/env bash
set -euo pipefail

# scripts/setup-android.sh
# Automatización de preparación, inicialización y parcheo de Android para NetTerminal
# Optimizado para Samsung One UI 6.1 (Android 14 / API 34) y One UI 8.5 (Android 16 / API 36)
# Repositorio: Parzval-Net/NetTerminal_Android

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "$ROOT_DIR"

echo "=========================================================="
echo "  NetTerminal Android: Configuración y Parcheo de Build   "
echo "=========================================================="

# 1. Detectar o configurar variables de entorno ANDROID_HOME y NDK_HOME
if [ -z "${ANDROID_HOME:-}" ]; then
  if [ -n "${ANDROID_SDK_ROOT:-}" ] && [ -d "$ANDROID_SDK_ROOT" ]; then
    export ANDROID_HOME="$ANDROID_SDK_ROOT"
  elif [ -d "$HOME/Library/Android/sdk" ]; then
    export ANDROID_HOME="$HOME/Library/Android/sdk"
  elif [ -d "/opt/homebrew/share/android-commandlinetools" ]; then
    export ANDROID_HOME="/opt/homebrew/share/android-commandlinetools"
  elif [ -d "/usr/local/lib/android/sdk" ]; then
    export ANDROID_HOME="/usr/local/lib/android/sdk"
  fi
fi

if [ -n "${ANDROID_HOME:-}" ]; then
  echo "✔ ANDROID_HOME detectado: $ANDROID_HOME"
else
  echo "⚠ ANDROID_HOME no está definido. Asegúrate de tener Android SDK configurado."
fi

if [ -z "${NDK_HOME:-}" ]; then
  if [ -n "${ANDROID_NDK_HOME:-}" ] && [ -d "$ANDROID_NDK_HOME" ]; then
    export NDK_HOME="$ANDROID_NDK_HOME"
  elif [ -n "${ANDROID_NDK_ROOT:-}" ] && [ -d "$ANDROID_NDK_ROOT" ]; then
    export NDK_HOME="$ANDROID_NDK_ROOT"
  elif [ -n "${ANDROID_HOME:-}" ] && [ -d "$ANDROID_HOME/ndk" ]; then
    # Tomar la última versión de NDK instalada
    LATEST_NDK=$(ls -1d "$ANDROID_HOME/ndk/"* 2>/dev/null | sort -V | tail -n 1 || true)
    if [ -n "$LATEST_NDK" ] && [ -d "$LATEST_NDK" ]; then
      export NDK_HOME="$LATEST_NDK"
    fi
  fi
fi

if [ -n "${NDK_HOME:-}" ]; then
  echo "✔ NDK_HOME detectado: $NDK_HOME"
else
  echo "⚠ NDK_HOME no está definido. Tauri Android lo requerirá para compilar el código Rust."
fi

# 2. Inicializar proyecto Android si no existe
ANDROID_DIR="$ROOT_DIR/src-tauri/gen/android"
if [ ! -d "$ANDROID_DIR" ] || [ ! -f "$ANDROID_DIR/app/build.gradle.kts" ]; then
  echo "→ Inicializando proyecto Android con Tauri CLI..."
  npx tauri android init --ci
else
  echo "✔ Proyecto Android ya inicializado en $ANDROID_DIR"
fi

# 3. Parchear AndroidManifest.xml (Permisos de Red, configChanges para Samsung DeX/Multi-Window y SoftInput adjustResize)
MANIFEST_FILE="$ANDROID_DIR/app/src/main/AndroidManifest.xml"
if [ -f "$MANIFEST_FILE" ]; then
  echo "→ Parcheando AndroidManifest.xml con permisos de red, configChanges y windowSoftInputMode..."
  python3 - <<'PY'
import os, re

manifest_path = "src-tauri/gen/android/app/src/main/AndroidManifest.xml"
if not os.path.exists(manifest_path):
    print("Error: AndroidManifest.xml no encontrado.")
    exit(1)

with open(manifest_path, "r", encoding="utf-8") as f:
    content = f.read()

# Permisos requeridos para NetTerminal (cliente SSH, Telnet, SNMP, Ping, HTTP, TFTP)
required_permissions = [
    '<uses-permission android:name="android.permission.INTERNET" />',
    '<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />',
    '<uses-permission android:name="android.permission.ACCESS_WIFI_STATE" />'
]

for perm in required_permissions:
    if perm not in content:
        manifest_tag = re.search(r'<manifest[^>]*>', content)
        if manifest_tag:
            insert_pos = manifest_tag.end()
            content = content[:insert_pos] + "\n    " + perm + content[insert_pos:]
            print(f"  + Agregado permiso: {perm}")
        else:
            print(f"  ! Advertencia: no se encontró etiqueta <manifest> para {perm}")
    else:
        print(f"  ✔ Permiso ya presente: {perm}")

# Asegurar android:configChanges completo para evitar reinicio de MainActivity en Samsung DeX / Multi-Window / tablets
full_config_changes = 'android:configChanges="orientation|keyboardHidden|keyboard|screenSize|locale|smallestScreenSize|screenLayout|uiMode|density|fontScale|layoutDirection|colorMode|navigation|touchscreen"'
content = re.sub(r'android:configChanges="[^"]*"', full_config_changes, content)

# Asegurar android:windowSoftInputMode="adjustResize" en MainActivity
activity_match = re.search(r'(<activity[^>]*android:name="\.MainActivity"[^>]*)>', content)
if activity_match:
    activity_tag = activity_match.group(1)
    if 'android:windowSoftInputMode' not in activity_tag:
        new_tag = activity_tag + '\n            android:windowSoftInputMode="adjustResize">'
        content = content[:activity_match.start()] + new_tag + content[activity_match.end():]
        print("  + Agregado android:windowSoftInputMode=\"adjustResize\" a MainActivity")
    else:
        print("  ✔ android:windowSoftInputMode ya configurado en MainActivity")
else:
    if 'android:windowSoftInputMode="adjustResize"' not in content:
        content = content.replace(
            'android:name=".MainActivity"',
            'android:name=".MainActivity"\n            android:windowSoftInputMode="adjustResize"'
        )
        print("  + Reemplazado atributo para agregar windowSoftInputMode=\"adjustResize\"")

with open(manifest_path, "w", encoding="utf-8") as f:
    f.write(content)

print("✔ AndroidManifest.xml actualizado con éxito.")
PY
else
  echo "⚠ No se encontró $MANIFEST_FILE"
fi

# 4. Asegurar configuración segura en app/build.gradle.kts (SDK 36, packaging 16 KB, CleartextTraffic y desactivar R8 destructivo en JNI)
BUILD_GRADLE="$ANDROID_DIR/app/build.gradle.kts"
if [ -f "$BUILD_GRADLE" ]; then
  echo "→ Verificando app/build.gradle.kts..."
  python3 - <<'PY'
import re

gradle_path = "src-tauri/gen/android/app/build.gradle.kts"
with open(gradle_path, "r", encoding="utf-8") as f:
    gradle_content = f.read()

gradle_content = gradle_content.replace("minSdk = 24", "minSdk = 26")
gradle_content = gradle_content.replace("compileSdk = 37", "compileSdk = 36")
gradle_content = gradle_content.replace("targetSdk = 37", "targetSdk = 36")
gradle_content = gradle_content.replace("targetSdk = 35", "targetSdk = 36")
gradle_content = gradle_content.replace('manifestPlaceholders["usesCleartextTraffic"] = "false"', 'manifestPlaceholders["usesCleartextTraffic"] = "true"')

if "useLegacyPackaging = false" not in gradle_content:
    gradle_content = gradle_content.replace(
        "    buildTypes {",
        "    packaging {\n        jniLibs {\n            useLegacyPackaging = false\n        }\n    }\n    buildTypes {"
    )

# Evitar que R8 elimine las clases puente JNI de Tauri/Wry antes de que cargo genere proguard-tauri.pro
old_opt = re.compile(r'optimization\s*\{\s*enable\s*=\s*true\s*\}', re.MULTILINE)
if old_opt.search(gradle_content):
    gradle_content = old_opt.sub(
        'manifestPlaceholders["usesCleartextTraffic"] = "true"\n            isMinifyEnabled = false\n            isShrinkResources = false',
        gradle_content
    )

with open(gradle_path, "w", encoding="utf-8") as f:
    f.write(gradle_content)
print("  ✔ app/build.gradle.kts verificado y actualizado")
PY
fi

# 5. Asegurar reglas de protección JNI en proguard-rules.pro
PROGUARD_FILE="$ANDROID_DIR/app/proguard-rules.pro"
cat > "$PROGUARD_FILE" <<'PRO'
# Reglas de ProGuard / R8 para NetTerminal Android (Tauri 2 + Wry + JNI)
-keepattributes Signature,InnerClasses,EnclosingMethod,RuntimeVisibleAnnotations,AnnotationDefault,SourceFile,LineNumberTable

# Preservar actividades y clases generadas del paquete de la aplicación y Tauri/Wry llamadas desde Rust vía JNI
-keep class cl.netterminal.app.** { *; }
-keep class app.tauri.** { *; }
-keep class * extends app.tauri.plugin.Plugin { *; }
-keep @app.tauri.annotation.TauriPlugin class * { *; }
-keep @app.tauri.annotation.Command class * { *; }
-keep @app.tauri.annotation.InvokeArg class * { *; }

# Preservar todos los métodos nativos JNI y puentes JavascriptInterface del WebView
-keepclasseswithmembernames class * {
    native <methods>;
}
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
    @app.tauri.annotation.** <fields>;
    @app.tauri.annotation.** <methods>;
}

# Evitar advertencias de clases de escritorio no presentes en Android
-dontwarn javax.naming.**
-dontwarn java.awt.**
-dontwarn rust.tls.platformverifier.**
-keep class rust.tls.platformverifier.** { *; }
PRO
echo "✔ proguard-rules.pro configurado con reglas JNI de Tauri/Wry"

# 6. Parchear MainActivity.kt de forma defensiva para unificar Edge-to-Edge entre One UI 6.1 (Android 14) y One UI 8.5 (Android 16)
MAIN_ACTIVITY="$ANDROID_DIR/app/src/main/java/cl/netterminal/app/MainActivity.kt"
if [ -f "$MAIN_ACTIVITY" ]; then
  cat > "$MAIN_ACTIVITY" <<'KT'
package cl.netterminal.app

import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.view.View
import android.view.WindowManager
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    runCatching {
      val bgColor = Color.parseColor("#0e1116")
      window?.let { win ->
        // Unificar Edge-to-Edge entre Android 14 (One UI 6.1) y Android 16 (One UI 8.5)
        WindowCompat.setDecorFitsSystemWindows(win, false)
        @Suppress("DEPRECATION")
        win.statusBarColor = Color.TRANSPARENT
        @Suppress("DEPRECATION")
        win.navigationBarColor = Color.TRANSPARENT
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
          win.isStatusBarContrastEnforced = false
          win.isNavigationBarContrastEnforced = false
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
          win.attributes = win.attributes.apply {
            layoutInDisplayCutoutMode =
              if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS
              } else {
                WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
              }
          }
        }
        win.decorView.let { decor ->
          decor.setBackgroundColor(bgColor)
          WindowCompat.getInsetsController(win, decor).apply {
            isAppearanceLightStatusBars = false
            isAppearanceLightNavigationBars = false
          }
        }
      }
      findViewById<View>(android.R.id.content)?.let { content ->
        content.setBackgroundColor(bgColor)
        ViewCompat.setOnApplyWindowInsetsListener(content) { view, insets ->
          val bars = insets.getInsets(
            WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()
          )
          val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
          view.setPadding(bars.left, bars.top, bars.right, maxOf(bars.bottom, ime.bottom))
          WindowInsetsCompat.CONSUMED
        }
        ViewCompat.requestApplyInsets(content)
      }
    }
  }
}
KT
  echo "✔ MainActivity.kt configurado para One UI 6.1 (Android 14) y One UI 8.5 (Android 16)"
fi

# 7. Asegurar permisos de ejecución para Gradle wrapper
if [ -f "$ANDROID_DIR/gradlew" ]; then
  chmod +x "$ANDROID_DIR/gradlew"
  echo "✔ Permisos de ejecución aplicados a gradlew"
fi

echo "=========================================================="
echo "✔ Configuración de Android finalizada exitosamente."
echo "  Puedes ejecutar: npm run android:build"
echo "=========================================================="
