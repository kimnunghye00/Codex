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
    private static final String DEFAULT_COMPONENT = "RouteLauncherActivity";
    private static final long MOVE_HOME_DELAY_MS = 220L;
    private static final long APPLY_DELAY_MS = 320L;
    private static final String TAG = "DanduliAppIcon";

    private static final Map<String, String> ICON_COMPONENTS = new LinkedHashMap<>();
    private static final Map<String, String> LEGACY_ICON_COMPONENTS = new LinkedHashMap<>();
    private static final String[] LEGACY_COMPONENTS = {
            "DanduliRouteIconV2", "DanduliRouteIconV3", "DanduliRouteIconV4",
            "DanduliHeartChatIconV2", "DanduliHeartChatIconV3", "DanduliHeartChatIconV4",
            "DanduliCoupleLoveIconV2", "DanduliCoupleLoveIconV3", "DanduliCoupleLoveIconV4",
            "DanduliCoupleDateIconV2", "DanduliCoupleDateIconV3", "DanduliCoupleDateIconV4",
            "RouteDefaultIcon", "RouteHeartIcon", "RoutePinDuoIcon", "RouteHeartChatIcon",
            "RouteOurRouteIcon", "RouteNightIcon", "RouteCreamIcon", "RouteMinimalIcon",
            "DanduliCoupleLoveIcon", "DanduliCoupleDateIcon"
    };

    private boolean swapInProgress = false;

    static {
        ICON_COMPONENTS.put("route", "RouteLauncherActivity");
        ICON_COMPONENTS.put("heart-chat", "HeartChatLauncherActivity");
        ICON_COMPONENTS.put("couple-love", "CoupleLoveLauncherActivity");
        ICON_COMPONENTS.put("couple-date", "CoupleDateLauncherActivity");

        LEGACY_ICON_COMPONENTS.put("DanduliRouteIconV2", "route");
        LEGACY_ICON_COMPONENTS.put("DanduliRouteIconV3", "route");
        LEGACY_ICON_COMPONENTS.put("DanduliRouteIconV4", "route");
        LEGACY_ICON_COMPONENTS.put("RouteDefaultIcon", "route");

        LEGACY_ICON_COMPONENTS.put("DanduliHeartChatIconV2", "heart-chat");
        LEGACY_ICON_COMPONENTS.put("DanduliHeartChatIconV3", "heart-chat");
        LEGACY_ICON_COMPONENTS.put("DanduliHeartChatIconV4", "heart-chat");
        LEGACY_ICON_COMPONENTS.put("RouteHeartChatIcon", "heart-chat");

        LEGACY_ICON_COMPONENTS.put("DanduliCoupleLoveIconV2", "couple-love");
        LEGACY_ICON_COMPONENTS.put("DanduliCoupleLoveIconV3", "couple-love");
        LEGACY_ICON_COMPONENTS.put("DanduliCoupleLoveIconV4", "couple-love");
        LEGACY_ICON_COMPONENTS.put("DanduliCoupleLoveIcon", "couple-love");

        LEGACY_ICON_COMPONENTS.put("DanduliCoupleDateIconV2", "couple-date");
        LEGACY_ICON_COMPONENTS.put("DanduliCoupleDateIconV3", "couple-date");
        LEGACY_ICON_COMPONENTS.put("DanduliCoupleDateIconV4", "couple-date");
        LEGACY_ICON_COMPONENTS.put("DanduliCoupleDateIcon", "couple-date");
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

    private List<String> allManagedComponents() {
        List<String> components = new ArrayList<>(ICON_COMPONENTS.values());
        components.addAll(Arrays.asList(LEGACY_COMPONENTS));
        return components;
    }

    private String enabledLauncherComponent() {
        for (String component : ICON_COMPONENTS.values()) {
            if (componentEnabled(component)) return component;
        }
        for (String component : LEGACY_COMPONENTS) {
            if (componentEnabled(component)) return component;
        }
        return null;
    }

    private String currentIcon() {
        SharedPreferences prefs = getContext().getSharedPreferences(PREFS, 0);
        String saved = prefs.getString(PREF_ICON, "route");
        String savedComponent = ICON_COMPONENTS.get(saved);
        if (savedComponent != null && componentEnabled(savedComponent)) return saved;

        for (Map.Entry<String, String> entry : ICON_COMPONENTS.entrySet()) {
            if (componentEnabled(entry.getValue())) return entry.getKey();
        }
        for (Map.Entry<String, String> entry : LEGACY_ICON_COMPONENTS.entrySet()) {
            if (componentEnabled(entry.getKey())) return entry.getValue();
        }
        return "route";
    }

    private void setState(String component, int state, int flags) {
        getContext().getPackageManager().setComponentEnabledSetting(
                componentFor(component),
                state,
                flags
        );
    }

    private void applyExclusiveComponent(String selectedComponent, String previousComponent) {
        setState(
                selectedComponent,
                PackageManager.COMPONENT_ENABLED_STATE_ENABLED,
                PackageManager.DONT_KILL_APP
        );

        for (String component : allManagedComponents()) {
            if (component.equals(selectedComponent) || component.equals(previousComponent)) continue;
            setState(
                    component,
                    PackageManager.COMPONENT_ENABLED_STATE_DISABLED,
                    PackageManager.DONT_KILL_APP
            );
        }

        if (previousComponent != null && !previousComponent.equals(selectedComponent)) {
            // The task was moved to Home first. Let Android restart this process
            // while removing the old launcher Activity so One UI refreshes the
            // icon using the newly enabled Activity component.
            setState(
                    previousComponent,
                    PackageManager.COMPONENT_ENABLED_STATE_DISABLED,
                    0
            );
        }
    }

    private void rollback(String selectedComponent, String previousComponent, String previousIcon) {
        try {
            setState(
                    selectedComponent,
                    PackageManager.COMPONENT_ENABLED_STATE_DISABLED,
                    PackageManager.DONT_KILL_APP
            );
            if (previousComponent != null) {
                setState(
                        previousComponent,
                        PackageManager.COMPONENT_ENABLED_STATE_ENABLED,
                        PackageManager.DONT_KILL_APP
                );
            } else {
                setState(
                        DEFAULT_COMPONENT,
                        PackageManager.COMPONENT_ENABLED_STATE_ENABLED,
                        PackageManager.DONT_KILL_APP
                );
            }
            getContext().getSharedPreferences(PREFS, 0)
                    .edit()
                    .putString(PREF_ICON, previousIcon)
                    .apply();
        } catch (Exception rollbackError) {
            Log.e(TAG, "Could not roll back launcher component switch", rollbackError);
        } finally {
            swapInProgress = false;
        }
    }

    @PluginMethod
    public void getIcon(PluginCall call) {
        String icon = currentIcon();
        JSObject result = new JSObject();
        result.put("icon", icon);
        result.put("component", enabledLauncherComponent());
        call.resolve(result);
    }

    @PluginMethod
    public void setIcon(PluginCall call) {
        String icon = call.getString("icon", "route");
        String selectedComponent = ICON_COMPONENTS.get(icon);
        if (selectedComponent == null) {
            call.reject("UNKNOWN_ICON");
            return;
        }
        if (swapInProgress) {
            call.reject("ICON_CHANGE_IN_PROGRESS");
            return;
        }

        try {
            String previousComponent = enabledLauncherComponent();
            String previousIcon = currentIcon();

            boolean saved = getContext().getSharedPreferences(PREFS, 0)
                    .edit()
                    .putString(PREF_ICON, icon)
                    .commit();
            if (!saved) throw new IllegalStateException("ICON_PREFERENCE_NOT_SAVED");

            if (selectedComponent.equals(previousComponent)) {
                LauncherRepairReceiver.ensureLauncherAvailable(getContext());
                JSObject result = new JSObject();
                result.put("icon", icon);
                result.put("pending", false);
                result.put("component", selectedComponent);
                call.resolve(result);
                return;
            }

            swapInProgress = true;
            JSObject result = new JSObject();
            result.put("icon", icon);
            result.put("pending", true);
            result.put("component", selectedComponent);
            call.resolve(result);

            Handler mainHandler = new Handler(Looper.getMainLooper());
            mainHandler.postDelayed(() -> {
                Activity activity = getActivity();
                if (activity != null) {
                    try {
                        activity.moveTaskToBack(true);
                    } catch (Exception ignored) {
                        // Continue with the component swap even if Home transition fails.
                    }
                }

                mainHandler.postDelayed(() -> {
                    try {
                        applyExclusiveComponent(selectedComponent, previousComponent);
                        swapInProgress = false;
                    } catch (Exception error) {
                        Log.e(TAG, "Could not switch launcher Activity", error);
                        rollback(selectedComponent, previousComponent, previousIcon);
                    }
                }, APPLY_DELAY_MS);
            }, MOVE_HOME_DELAY_MS);
        } catch (Exception error) {
            swapInProgress = false;
            call.reject("ICON_CHANGE_FAILED", error);
        }
    }
}
