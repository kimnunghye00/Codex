package com.route.couple;

import android.content.ComponentName;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@CapacitorPlugin(name = "RouteAppIcon")
public class AppIconPlugin extends Plugin {
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

    private ComponentName componentFor(String alias) {
        String packageName = getContext().getPackageName();
        return new ComponentName(packageName, packageName + "." + alias);
    }

    private boolean componentEnabled(String alias) {
        PackageManager packageManager = getContext().getPackageManager();
        int state = packageManager.getComponentEnabledSetting(componentFor(alias));
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

    private void applyIconState(String selectedAlias) {
        PackageManager packageManager = getContext().getPackageManager();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            List<PackageManager.ComponentEnabledSetting> settings = new ArrayList<>();
            for (String alias : ICON_ALIASES.values()) {
                int state = alias.equals(selectedAlias)
                        ? PackageManager.COMPONENT_ENABLED_STATE_ENABLED
                        : PackageManager.COMPONENT_ENABLED_STATE_DISABLED;
                settings.add(new PackageManager.ComponentEnabledSetting(
                        componentFor(alias), state, PackageManager.DONT_KILL_APP));
            }
            packageManager.setComponentEnabledSettings(settings);
            return;
        }
        packageManager.setComponentEnabledSetting(
                componentFor(selectedAlias),
                PackageManager.COMPONENT_ENABLED_STATE_ENABLED,
                PackageManager.DONT_KILL_APP
        );
        for (String alias : ICON_ALIASES.values()) {
            if (alias.equals(selectedAlias)) continue;
            packageManager.setComponentEnabledSetting(
                    componentFor(alias),
                    PackageManager.COMPONENT_ENABLED_STATE_DISABLED,
                    PackageManager.DONT_KILL_APP
            );
        }
    }

    private void verifyIconState(String selectedAlias) {
        if (!componentEnabled(selectedAlias)) throw new IllegalStateException("SELECTED_ICON_NOT_ENABLED");
        for (String alias : ICON_ALIASES.values()) {
            if (!alias.equals(selectedAlias) && componentEnabled(alias)) {
                throw new IllegalStateException("MULTIPLE_LAUNCHER_ICONS_ENABLED");
            }
        }
    }

    @PluginMethod
    public void getIcon(PluginCall call) {
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
            if (!icon.equals(currentIcon())) applyIconState(selectedAlias);
            verifyIconState(selectedAlias);
            boolean saved = getContext().getSharedPreferences(PREFS, 0)
                    .edit().putString(PREF_ICON, icon).commit();
            if (!saved) throw new IllegalStateException("ICON_PREFERENCE_NOT_SAVED");
            JSObject result = new JSObject();
            result.put("icon", currentIcon());
            call.resolve(result);
        } catch (Exception error) {
            call.reject("ICON_CHANGE_FAILED", error);
        }
    }
}
