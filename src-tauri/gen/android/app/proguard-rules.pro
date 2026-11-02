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
