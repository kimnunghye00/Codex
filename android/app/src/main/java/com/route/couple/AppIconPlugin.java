package com.route.couple;

import android.content.ComponentName;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.LinkedHashMap;
import java.util.Map;

@CapacitorPlugin(name = "RouteAppIcon")
public class AppIconPlugin extends Plugin {
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

    private ComponentName componentFor(String alias) {
        String packageName = getContext().getPackageName();
        return new ComponentName(packageName, packageName + "." + alias);
    }

    private boolean componentEnabled(String alias) {
        int state = getContext().getPackageManager().getComponentEnabledSetting(componentFor(alias));
        if (state == PackageManager.COMPONENT_ENABLED_STATE_ENABLED) return true;
        if (state == PackageManager.COMPONENT_ENABLED_STATE_DISABLED
                || state == PackageManager.COMPONENT_ENABLED_STATE_DISABLED_USER) return false;
        return DEFAULT_ALIAS.equals(alias);
    }

    private String currentIcon() {
        SharedPreferences prefs = getContext().getSharedPreferences(PREFS, 0);
        String saved = prefs.getString(PREF_ICON, "route");
        String savedAlias = ICON_ALIASES.get(saved);
        if (savedAlias != null && componentEnabled(savedAlias)) return saved;

        for (Map.Entry<String, String> entry : ICON_ALIASES.entrySet()) {
            if (componentEnabled(entry.getValue())) return entry.getKey();
        }
        return "route";
    }

    private void setState(String alias, int state) {
        getContext().getPackageManager().setComponentEnabledSetting(
                componentFor(alias),
                state,
                PackageManager.DONT_KILL_APP
        );
    }

    private void applyIconState(String selectedAlias) {
        // Use the long-established per-component API instead of the Android 13 batch API.
        // Samsung One UI observes these individual component changes more reliably.
        setState(selectedAlias, PackageManager.COMPONENT_ENABLED_STATE_ENABLED);

        for (String alias : ICON_ALIASES.values()) {
            if (!alias.equals(selectedAlias)) {
                setState(alias, PackageManager.COMPONENT_ENABLED_STATE_DISABLED);
            }
        }
        for (String alias : LEGACY_ALIASES) {
            setState(alias, PackageManager.COMPONENT_ENABLED_STATE_DISABLED);
        }
    }

    private void verifyIconState(String selectedAlias) {
        if (!componentEnabled(selectedAlias)) {
            throw new IllegalStateException("SELECTED_ICON_NOT_ENABLED");
        }
        for (String alias : ICON_ALIASES.values()) {
            if (!alias.equals(selectedAlias) && componentEnabled(alias)) {
                throw new IllegalStateException("MULTIPLE_LAUNCHER_ICONS_ENABLED");
            }
        }
        for (String alias : LEGACY_ALIASES) {
            if (componentEnabled(alias)) {
                throw new IllegalStateException("LEGACY_LAUNCHER_ICON_STILL_ENABLED");
            }
        }
    }

    @PluginMethod
    public void getIcon(PluginCall call) {
        LauncherRepairReceiver.ensureLauncherAvailable(getContext());
        JSObject result = new JSObject();
        result.put("icon", currentIcon());
        call.resolve(result);
    }

    @PluginMethod
    public void setIcon(PluginCall call) {
        String icon = call.getString("icon", "route");
        String selectedAlias = ICON_ALIASES.get(icon);
        if (selectedAlias == null) {
            call.reject("UNKNOWN_ICON");
            return;
        }

        try {
            // Always re-apply the component state. This also repairs a stale launcher entry.
            applyIconState(selectedAlias);
            verifyIconState(selectedAlias);

            boolean saved = getContext().getSharedPreferences(PREFS, 0)
                    .edit()
                    .putString(PREF_ICON, icon)
                    .commit();
            if (!saved) throw new IllegalStateException("ICON_PREFERENCE_NOT_SAVED");

            JSObject result = new JSObject();
            result.put("icon", currentIcon());
            result.put("component", selectedAlias);
            call.resolve(result);
        } catch (Exception error) {
            call.reject("ICON_CHANGE_FAILED", error);
        }
    }
}
