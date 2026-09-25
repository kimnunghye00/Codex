package com.route.couple;

import android.content.BroadcastReceiver;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;

import java.util.LinkedHashMap;
import java.util.Map;

/** Repairs launcher aliases after an APK update and migrates legacy launcher components. */
public class LauncherRepairReceiver extends BroadcastReceiver {
    private static final String PREFS = "route_app_icon";
    private static final String PREF_ICON = "selected_icon";
    private static final String DEFAULT_ALIAS = "DanduliRouteIconV2";
    private static final Map<String, String> ICON_ALIASES = new LinkedHashMap<>();
    private static final String[] LEGACY_ALIASES = {
            "RouteDefaultIcon", "RouteHeartIcon", "RoutePinDuoIcon", "RouteHeartChatIcon",
            "RouteOurRouteIcon", "RouteNightIcon", "RouteCreamIcon", "RouteMinimalIcon",
            "DanduliCoupleLoveIcon", "DanduliCoupleDateIcon"
    };

    static {
        ICON_ALIASES.put("route", DEFAULT_ALIAS);
        ICON_ALIASES.put("heart-chat", "DanduliHeartChatIconV2");
        ICON_ALIASES.put("couple-love", "DanduliCoupleLoveIconV2");
        ICON_ALIASES.put("couple-date", "DanduliCoupleDateIconV2");
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

    private static void setState(Context context, String alias, int state) {
        context.getPackageManager().setComponentEnabledSetting(
                componentFor(context, alias),
                state,
                PackageManager.DONT_KILL_APP
        );
    }

    private static String selectedAlias(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS, 0);
        String savedAlias = ICON_ALIASES.get(prefs.getString(PREF_ICON, "route"));
        return savedAlias != null ? savedAlias : DEFAULT_ALIAS;
    }

    private static void applyIconState(Context context, String selectedAlias) {
        setState(context, selectedAlias, PackageManager.COMPONENT_ENABLED_STATE_ENABLED);
        for (String alias : ICON_ALIASES.values()) {
            if (!alias.equals(selectedAlias)) {
                setState(context, alias, PackageManager.COMPONENT_ENABLED_STATE_DISABLED);
            }
        }
        for (String alias : LEGACY_ALIASES) {
            setState(context, alias, PackageManager.COMPONENT_ENABLED_STATE_DISABLED);
        }
    }

    public static void ensureLauncherAvailable(Context context) {
        try {
            String selected = selectedAlias(context);
            boolean needsRepair = !componentEnabled(context, selected);
            int enabledCount = 0;

            for (String alias : ICON_ALIASES.values()) {
                if (componentEnabled(context, alias)) enabledCount += 1;
            }
            if (enabledCount != 1) needsRepair = true;
            for (String alias : LEGACY_ALIASES) {
                if (componentEnabled(context, alias)) {
                    needsRepair = true;
                    break;
                }
            }

            if (needsRepair) applyIconState(context, selected);
        } catch (Exception ignored) {
            try {
                setState(context, DEFAULT_ALIAS, PackageManager.COMPONENT_ENABLED_STATE_ENABLED);
            } catch (Exception ignoredAgain) {
                // Launcher repair must never be able to crash the application.
            }
        }
    }
}
