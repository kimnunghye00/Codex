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
    private static final Map<String, String> ICON_ALIASES = new LinkedHashMap<>();

    static {
        ICON_ALIASES.put("route", "RouteDefaultIcon");
        ICON_ALIASES.put("heart", "RouteHeartIcon");
        ICON_ALIASES.put("night", "RouteNightIcon");
        ICON_ALIASES.put("cream", "RouteCreamIcon");
    }

    private ComponentName componentFor(String alias) {
        String packageName = getContext().getPackageName();
        return new ComponentName(packageName, packageName + "." + alias);
    }

    private boolean componentEnabled(String alias) {
        PackageManager packageManager = getContext().getPackageManager();
        int state = packageManager.getComponentEnabledSetting(componentFor(alias));
        if (state == PackageManager.COMPONENT_ENABLED_STATE_ENABLED) return true;
        if (state == PackageManager.COMPONENT_ENABLED_STATE_DISABLED || state == PackageManager.COMPONENT_ENABLED_STATE_DISABLED_USER) return false;
        return "RouteDefaultIcon".equals(alias);
    }

    private String currentIcon() {
        for (Map.Entry<String, String> entry : ICON_ALIASES.entrySet()) {
            if (componentEnabled(entry.getValue())) return entry.getKey();
        }
        SharedPreferences prefs = getContext().getSharedPreferences(PREFS, 0);
        String saved = prefs.getString(PREF_ICON, "route");
        return ICON_ALIASES.containsKey(saved) ? saved : "route";
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
            PackageManager packageManager = getContext().getPackageManager();

            // Enable the replacement first so the launcher never loses every entry.
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

            getContext().getSharedPreferences(PREFS, 0)
                    .edit()
                    .putString(PREF_ICON, icon)
                    .apply();

            JSObject result = new JSObject();
            result.put("icon", icon);
            call.resolve(result);
        } catch (Exception error) {
            call.reject("ICON_CHANGE_FAILED", error);
        }
    }
}
