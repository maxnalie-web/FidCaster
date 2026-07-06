package xyz.fidcaster.app;

import android.animation.Animator;
import android.animation.ObjectAnimator;
import android.animation.AnimatorSet;
import android.os.Bundle;
import android.view.animation.AccelerateInterpolator;
import androidx.core.splashscreen.SplashScreen;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // Must be called before super.onCreate() — this is what actually makes
        // the AppTheme.NoActionBarLaunch (parent Theme.SplashScreen, from the
        // androidx.core.splashscreen COMPAT library) apply correctly on
        // Android 7–11 (minSdk 24). Without this call the compat shim never
        // initializes on those versions — only real Android 12+ devices get
        // the splash from the theme alone, and it's the icon-reveal
        // animation is otherwise handled by the OS.
        SplashScreen splashScreen = SplashScreen.installSplashScreen(this);

        super.onCreate(savedInstanceState);

        // Custom exit transition: fade + slight zoom-out of the splash icon
        // as it hands off to the WebView, instead of the default instant cut.
        splashScreen.setOnExitAnimationListener(splashScreenView -> {
            final ObjectAnimator fade = ObjectAnimator.ofFloat(
                splashScreenView.getView(), "alpha", 1f, 0f);
            fade.setInterpolator(new AccelerateInterpolator());
            fade.setDuration(280);

            final ObjectAnimator scaleX = ObjectAnimator.ofFloat(
                splashScreenView.getIconView(), "scaleX", 1f, 1.15f);
            final ObjectAnimator scaleY = ObjectAnimator.ofFloat(
                splashScreenView.getIconView(), "scaleY", 1f, 1.15f);
            scaleX.setDuration(280);
            scaleY.setDuration(280);

            AnimatorSet set = new AnimatorSet();
            set.playTogether(fade, scaleX, scaleY);
            set.addListener(new android.animation.AnimatorListenerAdapter() {
                @Override
                public void onAnimationEnd(Animator animation) {
                    splashScreenView.remove();
                }
            });
            set.start();
        });
    }
}
