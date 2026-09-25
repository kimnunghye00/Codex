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

/** Repairs launcher aliases after an APK update and migrates legacy launcher components. */
public class LauncherRepairReceiver extends BroadcastReceiver {
    private static final String PREFS = "route_app_icon";
    private static final String PREF_ICON = "selected_icon";
    private static final String DEFAULT_ALIAS = "DanduliRouteIconV2";
    private static final Map<String, List<String>> ICON_ALIASES = new LinkedHashMap<>();
    private static final Map<String, String> LEGACY_ICON_ALIASES = new LinkedHashMap<>();
    private static final String[] LEGACY_ALIASES = {
            "RouteDefaultIcon", "RouteHeartIcon", "RoutePinDuoIcon", "RouteHeartChatIcon",
            "RouteOurRouteIcon", "RouteNightIcon", "RouteCreamIcon", "RouteMinimalIcon",
            "DanduliCoupleLoveIcon", "DanduliCoupleDateIcon"
    };

    static {
        ICON_ALIASES.put("route", Arrays.asList(
                "DanduliRouteIconV3", "DanduliRouteIconV4", "DanduliRouteIconV2"));
        ICON_ALIASES.put("heart-chat", Arrays.asList(
                "DanduliHeartChatIconV3", "DanduliHeartChatIconV4", "DanduliHeartChatIconV2"));
        ICON_ALIASES.put("couple-love", Arrays.asList(
                "DanduliCoupleLoveIconV3", "DanduliCoupleLoveIconV4", "DanduliCoupleLoveIconV2"));
        ICON_ALIASES.put("couple-date", Arrays.asList(
                "DanduliCoupleDateIconV3", "DanduliCoupleDateIconV4", "DanduliCoupleDateIconV2"));

        LEGACY_ICON_ALIASES.put("route", "RouteDefaultIcon");
        LEGACY_ICON_ALIASES.put("heart-chat", "RouteHeartChatIcon");
        LEGACY_ICON_ALIASES.put("couple-love", "DanduliCoupleLoveIcon");
        LEGACY_ICON_ALIASES.put("couple-date", "DanduliCoupleDateIcon");
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

    private static String savedIcon(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS, 0);
        String saved = prefs.getString(PREF_ICON, "route");
        return ICON_ALIASES.containsKey(saved) ? saved : "route";
    }

    private static List<String> allManagedAliases() {
        List<String> aliases = new ArrayList<>();
        for (List<String> iconAliases : ICON_ALIASES.values()) aliases.addAll(iconAliases);
        aliases.addAll(Arrays.asList(LEGACY_ALIASES));
        return aliases;
    }

    private static String enabledAliasForIcon(Context context, String icon) {
        List<String> candidates = ICON_ALIASES.get(icon);
        if (candidates != null) {
            for (String alias : candidates) {
                if (componentEnabled(context, alias)) return alias;
            }
        }
        String legacyAlias = LEGACY_ICON_ALIASES.get(icon);
        return legacyAlias != null && componentEnabled(context, legacyAlias) ? legacyAlias : null;
    }

    private static String selectedAlias(Context context) {
        String icon = savedIcon(context);
        String activeAlias = enabledAliasForIcon(context, icon);
        List<String> candidates = ICON_ALIASES.get(icon);

        // Keep an already-active V2/V3/V4 component. If the saved icon still
        // points at a legacy component, move it to V3 so the launcher refreshes.
        if (activeAlias != null && !Arrays.asList(LEGACY_ALIASES).contains(activeAlias)) {
            return activeAlias;
        }
        for (String alias : candidates) {
            if (!alias.equals(activeAlias)) return alias;
        }
        return DEFAULT_ALIAS;
    }

    private static void applyIconState(Context context, String selectedAlias) {
        setState(context, selectedAlias, PackageManager.COMPONENT_ENABLED_STATE_ENABLED);
        for (String alias : allManagedAliases()) {
            if (!alias.equals(selectedAlias)) {
                setState(context, alias, PackageManager.COMPONENT_ENABLED_STATE_DISABLED);
            }
        }
    }

    public static void ensureLauncherAvailable(Context context) {
        try {
            String selected = selectedAlias(context);
            int enabledCount = 0;
            for (String alias : allManagedAliases()) {
                if (componentEnabled(context, alias)) enabledCount++;
            }

            boolean needsRepair = !componentEnabled(context, selected) || enabledCount != 1;
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
