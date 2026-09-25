package com.route.couple;

import android.app.Activity;
import android.content.ComponentName;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Handler;
import android.os.Looper;

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
    private static final long MOVE_HOME_DELAY_MS = 260L;
    private static final long FINAL_SWAP_DELAY_MS = 220L;
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

    private String enabledLauncherAlias() {
        for (String alias : ICON_ALIASES.values()) {
            if (componentEnabled(alias)) return alias;
        }
        for (String alias : LEGACY_ALIASES) {
            if (componentEnabled(alias)) return alias;
        }
        return null;
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

    private void setState(String alias, int state, int flags) {
        getContext().getPackageManager().setComponentEnabledSetting(
                componentFor(alias),
                state,
                flags
        );
    }

    private void prepareSwap(String selectedAlias, String currentAlias) {
        setState(
                selectedAlias,
                PackageManager.COMPONENT_ENABLED_STATE_ENABLED,
                PackageManager.DONT_KILL_APP
        );

        for (String alias : ICON_ALIASES.values()) {
            if (alias.equals(selectedAlias) || alias.equals(currentAlias)) continue;
            setState(alias, PackageManager.COMPONENT_ENABLED_STATE_DISABLED, PackageManager.DONT_KILL_APP);
        }
        for (String alias : LEGACY_ALIASES) {
            if (alias.equals(currentAlias)) continue;
            setState(alias, PackageManager.COMPONENT_ENABLED_STATE_DISABLED, PackageManager.DONT_KILL_APP);
        }
    }

    private void finishSwap(String selectedAlias, String previousAlias) {
        try {
            if (previousAlias != null && !previousAlias.equals(selectedAlias)) {
                // Intentionally omit DONT_KILL_APP for the final old-component disable.
                // Samsung One UI is much more reliable at refreshing the pinned launcher
                // icon when the package process is restarted after the component change.
                setState(previousAlias, PackageManager.COMPONENT_ENABLED_STATE_DISABLED, 0);
                return;
            }

            // The selected component is already current. Reassert it synchronously without
            // disturbing the running task; no launcher refresh is necessary in this case.
            setState(selectedAlias, PackageManager.COMPONENT_ENABLED_STATE_ENABLED, PackageManager.DONT_KILL_APP);
        } catch (Exception ignored) {
            // MainActivity/LauncherRepairReceiver will recover the saved icon on next launch.
        }
    }

    @PluginMethod
    public void getIcon(PluginCall call) {
        JSObject result = new JSObject();
        result.put("icon", currentIcon());
        result.put("component", enabledLauncherAlias());
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
            String previousAlias = enabledLauncherAlias();
            if (selectedAlias.equals(previousAlias)) {
                getContext().getSharedPreferences(PREFS, 0)
                        .edit()
                        .putString(PREF_ICON, icon)
                        .apply();
                JSObject result = new JSObject();
                result.put("icon", icon);
                result.put("pending", false);
                call.resolve(result);
                return;
            }

            boolean saved = getContext().getSharedPreferences(PREFS, 0)
                    .edit()
                    .putString(PREF_ICON, icon)
                    .commit();
            if (!saved) throw new IllegalStateException("ICON_PREFERENCE_NOT_SAVED");

            JSObject result = new JSObject();
            result.put("icon", icon);
            result.put("pending", true);
            result.put("component", selectedAlias);
            call.resolve(result);

            Handler mainHandler = new Handler(Looper.getMainLooper());
            mainHandler.postDelayed(() -> {
                Activity activity = getActivity();
                if (activity != null) {
                    try {
                        activity.moveTaskToBack(true);
                    } catch (Exception ignored) {
                        // Continue with the deferred launcher update.
                    }
                }
                mainHandler.postDelayed(() -> {
                    prepareSwap(selectedAlias, previousAlias);
                    mainHandler.postDelayed(
                            () -> finishSwap(selectedAlias, previousAlias),
                            FINAL_SWAP_DELAY_MS
                    );
                }, 350L);
            }, MOVE_HOME_DELAY_MS);
        } catch (Exception error) {
            call.reject("ICON_CHANGE_FAILED", error);
        }
    }
}
