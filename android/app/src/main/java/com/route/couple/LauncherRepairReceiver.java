package com.route.couple;

import android.content.BroadcastReceiver;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Migrates old activity-alias launcher state to the real launcher Activities and
 * guarantees that exactly one launcher component remains enabled.
 */
public class LauncherRepairReceiver extends BroadcastReceiver {
    private static final String PREFS = "route_app_icon";
    private static final String PREF_ICON = "selected_icon";
    private static final String DEFAULT_COMPONENT = "RouteLauncherActivity";

    private static final Map<String, String> ICON_COMPONENTS = new LinkedHashMap<>();
    private static final String[] LEGACY_COMPONENTS = {
            "DanduliRouteIconV2", "DanduliRouteIconV3", "DanduliRouteIconV4",
            "DanduliHeartChatIconV2", "DanduliHeartChatIconV3", "DanduliHeartChatIconV4",
            "DanduliCoupleLoveIconV2", "DanduliCoupleLoveIconV3", "DanduliCoupleLoveIconV4",
            "DanduliCoupleDateIconV2", "DanduliCoupleDateIconV3", "DanduliCoupleDateIconV4",
            "RouteDefaultIcon", "RouteHeartIcon", "RoutePinDuoIcon", "RouteHeartChatIcon",
            "RouteOurRouteIcon", "RouteNightIcon", "RouteCreamIcon", "RouteMinimalIcon",
            "DanduliCoupleLoveIcon", "DanduliCoupleDateIcon"
    };

    static {
        ICON_COMPONENTS.put("route", "RouteLauncherActivity");
        ICON_COMPONENTS.put("heart-chat", "HeartChatLauncherActivity");
        ICON_COMPONENTS.put("couple-love", "CoupleLoveLauncherActivity");
        ICON_COMPONENTS.put("couple-date", "CoupleDateLauncherActivity");
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
                || state == PackageManager.COMPONENT_ENABLED_STATE_DISABLED_UNTIL_USED) return false;
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

    private static List<String> allManagedComponents() {
        List<String> components = new ArrayList<>(ICON_COMPONENTS.values());
        components.addAll(Arrays.asList(LEGACY_COMPONENTS));
        return components;
    }

    private static void applyIconState(Context context, String selectedComponent) {
        setState(context, selectedComponent, PackageManager.COMPONENT_ENABLED_STATE_ENABLED);
        for (String component : allManagedComponents()) {
            if (!component.equals(selectedComponent)) {
                setState(context, component, PackageManager.COMPONENT_ENABLED_STATE_DISABLED);
            }
        }
    }

    public static void ensureLauncherAvailable(Context context) {
        try {
            String selectedComponent = ICON_COMPONENTS.get(savedIcon(context));
            if (selectedComponent == null) selectedComponent = DEFAULT_COMPONENT;

            int enabledCount = 0;
            for (String component : allManagedComponents()) {
                if (componentEnabled(context, component)) enabledCount++;
            }

            boolean legacyEnabled = false;
            for (String component : LEGACY_COMPONENTS) {
                if (componentEnabled(context, component)) {
                    legacyEnabled = true;
                    break;
                }
            }

            if (!componentEnabled(context, selectedComponent) || enabledCount != 1 || legacyEnabled) {
                applyIconState(context, selectedComponent);
            }
        } catch (Exception ignored) {
            try {
                setState(context, DEFAULT_COMPONENT, PackageManager.COMPONENT_ENABLED_STATE_ENABLED);
            } catch (Exception ignoredAgain) {
                // Launcher repair must never crash the application.
            }
        }
    }
}
