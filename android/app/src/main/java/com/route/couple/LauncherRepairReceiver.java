package com.route.couple;

import android.content.BroadcastReceiver;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Restores exactly one of the four current DANDULI launcher aliases after an APK
 * update. Old ROUTE/V2/V3/V4 aliases are intentionally no longer declared.
 */
public class LauncherRepairReceiver extends BroadcastReceiver {
    private static final String PREFS = "route_app_icon";
    private static final String PREF_ICON = "selected_icon";
    private static final String DEFAULT_COMPONENT = "DanduliDefaultLauncher";
    private static final Map<String, String> ICON_COMPONENTS = new LinkedHashMap<>();

    static {
        ICON_COMPONENTS.put("route", "DanduliDefaultLauncher");
        ICON_COMPONENTS.put("heart-chat", "DanduliChatLauncher");
        ICON_COMPONENTS.put("couple-love", "DanduliLoveLauncher");
        ICON_COMPONENTS.put("couple-date", "DanduliDateLauncher");
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || !Intent.ACTION_MY_PACKAGE_REPLACED.equals(intent.getAction())) return;
        ensureLauncherAvailable(context);
    }

    private static ComponentName componentFor(Context context, String component) {
        String packageName = context.getPackageName();
        return new ComponentName(packageName, packageName + "." + component);
    }

    private static boolean componentEnabled(Context context, String component) {
        int state = context.getPackageManager().getComponentEnabledSetting(componentFor(context, component));
        if (state == PackageManager.COMPONENT_ENABLED_STATE_ENABLED) return true;
        if (state == PackageManager.COMPONENT_ENABLED_STATE_DISABLED
                || state == PackageManager.COMPONENT_ENABLED_STATE_DISABLED_USER
                || state == PackageManager.COMPONENT_ENABLED_STATE_DISABLED_UNTIL_USED) {
            return false;
        }
        return DEFAULT_COMPONENT.equals(component);
    }

    private static void setState(Context context, String component, int state) {
        context.getPackageManager().setComponentEnabledSetting(
                componentFor(context, component),
                state,
                PackageManager.DONT_KILL_APP
        );
    }

    private static String savedIcon(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS, 0);
        String saved = prefs.getString(PREF_ICON, "route");
        return ICON_COMPONENTS.containsKey(saved) ? saved : "route";
    }

    public static void ensureLauncherAvailable(Context context) {
        try {
            String selected = ICON_COMPONENTS.get(savedIcon(context));
            if (selected == null) selected = DEFAULT_COMPONENT;

            int enabledCount = 0;
            for (String component : ICON_COMPONENTS.values()) {
                if (componentEnabled(context, component)) enabledCount++;
            }

            if (!componentEnabled(context, selected) || enabledCount != 1) {
                setState(context, selected, PackageManager.COMPONENT_ENABLED_STATE_ENABLED);
                for (String component : ICON_COMPONENTS.values()) {
                    if (!component.equals(selected)) {
                        setState(context, component, PackageManager.COMPONENT_ENABLED_STATE_DISABLED);
                    }
                }
            }
        } catch (Exception ignored) {
            try {
                setState(context, DEFAULT_COMPONENT, PackageManager.COMPONENT_ENABLED_STATE_ENABLED);
            } catch (Exception ignoredAgain) {
                // Never allow launcher repair to crash app startup.
            }
        }
    }
}
