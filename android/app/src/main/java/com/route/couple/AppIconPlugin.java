package com.route.couple;

import android.content.ComponentName;
import android.content.pm.PackageManager;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.HashMap;
import java.util.Map;

@CapacitorPlugin(name = "RouteAppIcon")
public class AppIconPlugin extends Plugin {
    private static final Map<String, String> ICON_ALIASES = new HashMap<>();

    static {
        ICON_ALIASES.put("route", "RouteDefaultIcon");
        ICON_ALIASES.put("heart", "RouteHeartIcon");
        ICON_ALIASES.put("night", "RouteNightIcon");
        ICON_ALIASES.put("cream", "RouteCreamIcon");
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
            String packageName = getContext().getPackageName();

            // Enable the new launcher entry first so there is never a moment with no launcher icon.
            packageManager.setComponentEnabledSetting(
                    new ComponentName(packageName, packageName + "." + selectedAlias),
                    PackageManager.COMPONENT_ENABLED_STATE_ENABLED,
                    PackageManager.DONT_KILL_APP
            );

            for (String alias : ICON_ALIASES.values()) {
                if (alias.equals(selectedAlias)) continue;
                packageManager.setComponentEnabledSetting(
                        new ComponentName(packageName, packageName + "." + alias),
                        PackageManager.COMPONENT_ENABLED_STATE_DISABLED,
                        PackageManager.DONT_KILL_APP
                );
            }

            JSObject result = new JSObject();
            result.put("icon", icon);
            call.resolve(result);
        } catch (Exception error) {
            call.reject("ICON_CHANGE_FAILED", error);
        }
    }
}
