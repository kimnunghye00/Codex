package com.route.couple;

import android.content.BroadcastReceiver;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;

/**
 * Repairs launcher aliases after an APK update without changing the user's
 * selected icon when that selection is still valid.
 */
public class LauncherRepairReceiver extends BroadcastReceiver {
    private static final String DEFAULT_ALIAS = "RouteDefaultIcon";
    private static final String[] ICON_ALIASES = {
            DEFAULT_ALIAS,
            "RouteHeartIcon",
            "RouteNightIcon",
            "RouteCreamIcon"
    };

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || !Intent.ACTION_MY_PACKAGE_REPLACED.equals(intent.getAction())) return;
        ensureLauncherAvailable(context);
    }

    public static void ensureLauncherAvailable(Context context) {
        try {
            PackageManager packageManager = context.getPackageManager();
            String packageName = context.getPackageName();

            for (String alias : ICON_ALIASES) {
                ComponentName component = new ComponentName(packageName, packageName + "." + alias);
                int state = packageManager.getComponentEnabledSetting(component);
                if (state == PackageManager.COMPONENT_ENABLED_STATE_ENABLED) return;
                if (state == PackageManager.COMPONENT_ENABLED_STATE_DEFAULT && DEFAULT_ALIAS.equals(alias)) return;
            }

            ComponentName defaultComponent = new ComponentName(packageName, packageName + "." + DEFAULT_ALIAS);
            packageManager.setComponentEnabledSetting(
                    defaultComponent,
                    PackageManager.COMPONENT_ENABLED_STATE_ENABLED,
                    PackageManager.DONT_KILL_APP
            );
        } catch (Exception ignored) {
            // Launcher repair must never be able to crash the application.
        }
    }
}
