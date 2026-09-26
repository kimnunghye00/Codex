package com.e2.danduli;

import android.content.ComponentName;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;
import android.util.Log;

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
    private static final String DEFAULT_COMPONENT = "DanduliDefaultLauncher";
    private static final String TAG = "DanduliAppIcon";

    private static final Map<String, String> ICON_COMPONENTS = new LinkedHashMap<>();
    private boolean swapInProgress = false;

    static {
        ICON_COMPONENTS.put("route", "DanduliDefaultLauncher");
        ICON_COMPONENTS.put("heart-chat", "DanduliChatLauncher");
        ICON_COMPONENTS.put("couple-love", "DanduliLoveLauncher");
        ICON_COMPONENTS.put("couple-date", "DanduliDateLauncher");
    }

    private ComponentName componentFor(String component) {
        String packageName = getContext().getPackageName();
        return new ComponentName(packageName, packageName + "." + component);
    }

    private boolean componentEnabled(String component) {
        int state = getContext().getPackageManager().getComponentEnabledSetting(componentFor(component));
        if (state == PackageManager.COMPONENT_ENABLED_STATE_ENABLED) return true;
        if (state == PackageManager.COMPONENT_ENABLED_STATE_DISABLED
                || state == PackageManager.COMPONENT_ENABLED_STATE_DISABLED_USER
                || state == PackageManager.COMPONENT_ENABLED_STATE_DISABLED_UNTIL_USED) return false;
        return DEFAULT_COMPONENT.equals(component);
    }

    private String enabledLauncherComponent() {
        for (String component : ICON_COMPONENTS.values()) {
            if (componentEnabled(component)) return component;
        }
        return null;
    }

    private boolean onlyLauncherEnabled(String selected) {
        for (String component : ICON_COMPONENTS.values()) {
            if (componentEnabled(component) != component.equals(selected)) return false;
        }
        return true;
    }

    private String currentIcon() {
        String enabled = enabledLauncherComponent();
        for (Map.Entry<String, String> entry : ICON_COMPONENTS.entrySet()) {
            if (entry.getValue().equals(enabled)) return entry.getKey();
        }
        return "route";
    }

    private void setState(String component, int state) {
        getContext().getPackageManager().setComponentEnabledSetting(
                componentFor(component), state, PackageManager.DONT_KILL_APP
        );
    }

    private void selectLauncher(String selected) {
        PackageManager packageManager = getContext().getPackageManager();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            // Android 13+ changes the four aliases in one transaction. The launcher
            // never sees an intermediate state with no usable entry.
            List<PackageManager.ComponentEnabledSetting> settings = new ArrayList<>();
            for (String component : ICON_COMPONENTS.values()) {
                settings.add(new PackageManager.ComponentEnabledSetting(
                        componentFor(component),
                        component.equals(selected)
                                ? PackageManager.COMPONENT_ENABLED_STATE_ENABLED
                                : PackageManager.COMPONENT_ENABLED_STATE_DISABLED,
                        PackageManager.DONT_KILL_APP
                ));
            }
            packageManager.setComponentEnabledSettings(settings);
        } else {
            // On older Android versions keep an entry available throughout the swap.
            setState(selected, PackageManager.COMPONENT_ENABLED_STATE_ENABLED);
            for (String component : ICON_COMPONENTS.values()) {
                if (!component.equals(selected)) {
                    setState(component, PackageManager.COMPONENT_ENABLED_STATE_DISABLED);
                }
            }
        }

        if (!onlyLauncherEnabled(selected)) {
            throw new IllegalStateException("LAUNCHER_STATE_MISMATCH");
        }
        // Confirm that the selected alias resolves to an icon in this APK.
        try {
            packageManager.getActivityIcon(componentFor(selected));
        } catch (PackageManager.NameNotFoundException error) {
            throw new IllegalStateException("LAUNCHER_ICON_MISSING", error);
        }
    }

    @PluginMethod
    public void getIcon(PluginCall call) {
        JSObject result = new JSObject();
        result.put("icon", currentIcon());
        result.put("component", enabledLauncherComponent());
        call.resolve(result);
    }

    @PluginMethod
    public void setIcon(PluginCall call) {
        String icon = call.getString("icon", "route");
        String selected = ICON_COMPONENTS.get(icon);
        if (selected == null) {
            call.reject("UNKNOWN_ICON");
            return;
        }
        if (swapInProgress) {
            call.reject("ICON_CHANGE_IN_PROGRESS");
            return;
        }

        swapInProgress = true;
        String previous = null;
        try {
            previous = enabledLauncherComponent();
            SharedPreferences preferences = getContext().getSharedPreferences(PREFS, 0);
            if (!onlyLauncherEnabled(selected)) selectLauncher(selected);
            if (!preferences.edit().putString(PREF_ICON, icon).commit()) {
                throw new IllegalStateException("ICON_PREFERENCE_NOT_SAVED");
            }

            JSObject result = new JSObject();
            result.put("icon", icon);
            result.put("component", selected);
            call.resolve(result);
            Log.i(TAG, "Verified launcher icon: " + selected);
        } catch (Exception error) {
            Log.e(TAG, "Launcher icon switch failed", error);
            try {
                selectLauncher(previous == null ? DEFAULT_COMPONENT : previous);
            } catch (Exception rollbackError) {
                Log.e(TAG, "Could not restore the previous launcher", rollbackError);
            }
            call.reject("ICON_CHANGE_FAILED", error);
        } finally {
            swapInProgress = false;
        }
    }
}
