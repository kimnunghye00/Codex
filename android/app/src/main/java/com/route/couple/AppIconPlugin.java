package com.route.couple;

import android.app.Activity;
import android.content.ComponentName;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@CapacitorPlugin(name = "RouteAppIcon")
public class AppIconPlugin extends Plugin {
    private static final String PREFS = "route_app_icon";
    private static final String PREF_ICON = "selected_icon";
    private static final String DEFAULT_ALIAS = "DanduliRouteIconV2";
    private static final long MOVE_HOME_DELAY_MS = 260L;
    private static final long FINAL_SWAP_DELAY_MS = 220L;
    private static final long PREPARE_SWAP_DELAY_MS = 350L;
    private static final String TAG = "DanduliAppIcon";
    private static final Map<String, List<String>> ICON_ALIASES = new LinkedHashMap<>();
    private static final Map<String, String> LEGACY_ICON_ALIASES = new LinkedHashMap<>();
    private static final String[] LEGACY_ALIASES = {
            "RouteDefaultIcon", "RouteHeartIcon", "RoutePinDuoIcon", "RouteHeartChatIcon",
            "RouteOurRouteIcon", "RouteNightIcon", "RouteCreamIcon", "RouteMinimalIcon",
            "DanduliCoupleLoveIcon", "DanduliCoupleDateIcon"
    };

    private boolean swapInProgress = false;

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

    private List<String> allManagedAliases() {
        List<String> aliases = new ArrayList<>();
        for (List<String> iconAliases : ICON_ALIASES.values()) aliases.addAll(iconAliases);
        aliases.addAll(Arrays.asList(LEGACY_ALIASES));
        return aliases;
    }

    private String enabledAliasForIcon(String icon) {
        List<String> candidates = ICON_ALIASES.get(icon);
        if (candidates != null) {
            for (String alias : candidates) {
                if (componentEnabled(alias)) return alias;
            }
        }

        String legacyAlias = LEGACY_ICON_ALIASES.get(icon);
        return legacyAlias != null && componentEnabled(legacyAlias) ? legacyAlias : null;
    }

    private String enabledLauncherAlias() {
        for (List<String> aliases : ICON_ALIASES.values()) {
            for (String alias : aliases) {
                if (componentEnabled(alias)) return alias;
            }
        }
        for (String alias : LEGACY_ALIASES) {
            if (componentEnabled(alias)) return alias;
        }
        return null;
    }

    private String currentIcon() {
        SharedPreferences prefs = getContext().getSharedPreferences(PREFS, 0);
        String saved = prefs.getString(PREF_ICON, "route");
        if (enabledAliasForIcon(saved) != null) return saved;

        for (Map.Entry<String, List<String>> entry : ICON_ALIASES.entrySet()) {
            for (String alias : entry.getValue()) {
                if (componentEnabled(alias)) return entry.getKey();
            }
        }
        for (Map.Entry<String, String> entry : LEGACY_ICON_ALIASES.entrySet()) {
            if (componentEnabled(entry.getValue())) return entry.getKey();
        }
        return "route";
    }

    private String selectTargetAlias(String icon, String currentAlias) {
        List<String> candidates = ICON_ALIASES.get(icon);
        if (candidates == null) return null;

        // Use a different Android component on every selection. In particular,
        // selecting the already-active icon still gets a fresh launcher identity
        // so Samsung One UI cannot keep showing a cached icon for the old alias.
        for (String alias : candidates) {
            if (!alias.equals(currentAlias)) return alias;
        }
        return null;
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

        for (String alias : allManagedAliases()) {
            if (alias.equals(selectedAlias) || alias.equals(currentAlias)) continue;
            setState(alias, PackageManager.COMPONENT_ENABLED_STATE_DISABLED, PackageManager.DONT_KILL_APP);
        }
    }

    private void finishSwap(String selectedAlias, String previousAlias) {
        if (previousAlias != null && !previousAlias.equals(selectedAlias)) {
            // The app is already in the background. Omitting DONT_KILL_APP here
            // restarts the process and prompts One UI to refresh the launcher icon.
            setState(previousAlias, PackageManager.COMPONENT_ENABLED_STATE_DISABLED, 0);
            return;
        }
        setState(selectedAlias, PackageManager.COMPONENT_ENABLED_STATE_ENABLED, PackageManager.DONT_KILL_APP);
    }

    private void rollbackSwap(String selectedAlias, String previousAlias, String previousIcon) {
        try {
            setState(selectedAlias, PackageManager.COMPONENT_ENABLED_STATE_DISABLED, PackageManager.DONT_KILL_APP);
            if (previousAlias != null) {
                setState(previousAlias, PackageManager.COMPONENT_ENABLED_STATE_ENABLED, PackageManager.DONT_KILL_APP);
            }
            getContext().getSharedPreferences(PREFS, 0)
                    .edit()
                    .putString(PREF_ICON, previousIcon)
                    .apply();
        } catch (Exception error) {
            Log.e(TAG, "Could not roll back launcher icon switch", error);
        } finally {
            swapInProgress = false;
        }
    }

    private void finishSwapWithRetry(
            Handler handler,
            String selectedAlias,
            String previousAlias,
            String previousIcon,
            int attempt
    ) {
        try {
            finishSwap(selectedAlias, previousAlias);
            swapInProgress = false;
        } catch (Exception error) {
            Log.e(TAG, "Could not finish launcher icon switch (attempt " + (attempt + 1) + ")", error);
            if (attempt < 2) {
                handler.postDelayed(
                        () -> finishSwapWithRetry(handler, selectedAlias, previousAlias, previousIcon, attempt + 1),
                        FINAL_SWAP_DELAY_MS
                );
            } else {
                rollbackSwap(selectedAlias, previousAlias, previousIcon);
            }
        }
    }

    @PluginMethod
    public void getIcon(PluginCall call) {
        String icon = currentIcon();
        String component = enabledAliasForIcon(icon);
        if (component == null) component = enabledLauncherAlias();

        JSObject result = new JSObject();
        result.put("icon", icon);
        result.put("component", component);
        call.resolve(result);
    }

    @PluginMethod
    public void setIcon(PluginCall call) {
        String icon = call.getString("icon", "route");
        List<String> candidates = ICON_ALIASES.get(icon);
        if (candidates == null) {
            call.reject("UNKNOWN_ICON");
            return;
        }
        if (swapInProgress) {
            call.reject("ICON_CHANGE_IN_PROGRESS");
            return;
        }

        try {
            String previousAlias = enabledLauncherAlias();
            String previousIcon = currentIcon();
            String selectedAlias = selectTargetAlias(icon, previousAlias);
            if (selectedAlias == null) {
                call.reject("NO_FRESH_LAUNCHER_ALIAS");
                return;
            }

            boolean saved = getContext().getSharedPreferences(PREFS, 0)
                    .edit()
                    .putString(PREF_ICON, icon)
                    .commit();
            if (!saved) throw new IllegalStateException("ICON_PREFERENCE_NOT_SAVED");

            swapInProgress = true;
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
                    try {
                        prepareSwap(selectedAlias, previousAlias);
                    } catch (Exception error) {
                        Log.e(TAG, "Could not prepare launcher icon switch", error);
                        rollbackSwap(selectedAlias, previousAlias, previousIcon);
                        return;
                    }
                    mainHandler.postDelayed(
                            () -> finishSwapWithRetry(
                                    mainHandler,
                                    selectedAlias,
                                    previousAlias,
                                    previousIcon,
                                    0
                            ),
                            FINAL_SWAP_DELAY_MS
                    );
                }, PREPARE_SWAP_DELAY_MS);
            }, MOVE_HOME_DELAY_MS);
        } catch (Exception error) {
            swapInProgress = false;
            call.reject("ICON_CHANGE_FAILED", error);
        }
    }
}
