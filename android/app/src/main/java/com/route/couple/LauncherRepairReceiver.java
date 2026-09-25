package com.route.couple;

import android.content.BroadcastReceiver;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Repairs launcher aliases after an APK update while preserving the selected icon. */
public class LauncherRepairReceiver extends BroadcastReceiver {
    private static final String PREFS = "route_app_icon";
    private static final String PREF_ICON = "selected_icon";
    private static final String DEFAULT_ALIAS = "RouteDefaultIcon";
    private static final Map<String, String> ICON_ALIASES = new LinkedHashMap<>();

    static {
        ICON_ALIASES.put("route", DEFAULT_ALIAS);
        ICON_ALIASES.put("heart", "RouteHeartIcon");
        ICON_ALIASES.put("pin-duo", "RoutePinDuoIcon");
        ICON_ALIASES.put("heart-chat", "RouteHeartChatIcon");
        ICON_ALIASES.put("our-route", "RouteOurRouteIcon");
        ICON_ALIASES.put("night", "RouteNightIcon");
        ICON_ALIASES.put("cream", "RouteCreamIcon");
        ICON_ALIASES.put("minimal", "RouteMinimalIcon");
        ICON_ALIASES.put("couple-love", "DanduliCoupleLoveIcon");
        ICON_ALIASES.put("couple-date", "DanduliCoupleDateIcon");
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || !Intent.ACTION_MY_PACKAGE_REPLACED.equals(intent.getAction())) return;
        ensureLauncherAvailable(context);
    }

    private static ComponentName componentFor(Context context, String alias) {
        String packageName = context.getPackageName();
        return new ComponentName(packageName, packageName + "." + alias);
    }

    private static boolean componentEnabled(Context context, String alias) {
        int state = context.getPackageManager().getComponentEnabledSetting(componentFor(context, alias));
        if (state == PackageManager.COMPONENT_ENABLED_STATE_ENABLED) return true;
        if (state == PackageManager.COMPONENT_ENABLED_STATE_DISABLED
                || state == PackageManager.COMPONENT_ENABLED_STATE_DISABLED_USER) return false;
        return DEFAULT_ALIAS.equals(alias);
    }

    private static String selectedAlias(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS, 0);
        String savedAlias = ICON_ALIASES.get(prefs.getString(PREF_ICON, ""));
        if (savedAlias != null) return savedAlias;
        for (String alias : ICON_ALIASES.values()) {
            if (componentEnabled(context, alias)) return alias;
        }
        return DEFAULT_ALIAS;
    }

    private static void applyIconState(Context context, String selectedAlias) {
        PackageManager packageManager = context.getPackageManager();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            List<PackageManager.ComponentEnabledSetting> settings = new ArrayList<>();
            for (String alias : ICON_ALIASES.values()) {
                int state = alias.equals(selectedAlias)
                        ? PackageManager.COMPONENT_ENABLED_STATE_ENABLED
                        : PackageManager.COMPONENT_ENABLED_STATE_DISABLED;
                settings.add(new PackageManager.ComponentEnabledSetting(
                        componentFor(context, alias), state, PackageManager.DONT_KILL_APP));
            }
            packageManager.setComponentEnabledSettings(settings);
            return;
        }
        packageManager.setComponentEnabledSetting(
                componentFor(context, selectedAlias),
                PackageManager.COMPONENT_ENABLED_STATE_ENABLED,
                PackageManager.DONT_KILL_APP
        );
        for (String alias : ICON_ALIASES.values()) {
            if (alias.equals(selectedAlias)) continue;
            packageManager.setComponentEnabledSetting(
                    componentFor(context, alias),
                    PackageManager.COMPONENT_ENABLED_STATE_DISABLED,
                    PackageManager.DONT_KILL_APP
            );
        }
    }

    public static void ensureLauncherAvailable(Context context) {
        try {
            String selected = selectedAlias(context);
            int enabledCount = 0;
            boolean selectedEnabled = false;
            for (String alias : ICON_ALIASES.values()) {
                if (!componentEnabled(context, alias)) continue;
                enabledCount += 1;
                if (alias.equals(selected)) selectedEnabled = true;
            }
            if (selectedEnabled && enabledCount == 1) return;
            applyIconState(context, selected);
        } catch (Exception ignored) {
            try {
                context.getPackageManager().setComponentEnabledSetting(
                        componentFor(context, DEFAULT_ALIAS),
                        PackageManager.COMPONENT_ENABLED_STATE_ENABLED,
                        PackageManager.DONT_KILL_APP
                );
            } catch (Exception ignoredAgain) {
                // Launcher repair must never be able to crash the application.
            }
        }
    }
}
