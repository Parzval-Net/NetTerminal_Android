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
