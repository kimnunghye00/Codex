package com.route.couple;

import android.app.Activity;
import android.content.ComponentName;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Handler;
import android.os.Looper;
import android.os.Process;
import android.util.Log;

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
    private static final String DEFAULT_COMPONENT = "DanduliDefaultLauncher";
    private static final String TAG = "DanduliAppIcon";

    private static final long GO_HOME_DELAY_MS = 180L;
    private static final long REMOVE_OLD_DELAY_MS = 180L;
    private static final long ADD_NEW_DELAY_MS = 260L;
    private static final long PROCESS_EXIT_DELAY_MS = 700L;

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
                || state == PackageManager.COMPONENT_ENABLED_STATE_DISABLED_UNTIL_USED) {
            return false;
        }
        return DEFAULT_COMPONENT.equals(component);
    }

    private void setState(String component, int state) {
        getContext().getPackageManager().setComponentEnabledSetting(
                componentFor(component),
                state,
                PackageManager.DONT_KILL_APP
        );
    }

    private String enabledLauncherComponent() {
        for (String component : ICON_COMPONENTS.values()) {
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
        return "route";
    }

    private void disableEveryLauncherExcept(String keep) {
        for (String component : ICON_COMPONENTS.values()) {
            if (!component.equals(keep)) {
                setState(component, PackageManager.COMPONENT_ENABLED_STATE_DISABLED);
            }
        }
    }

    private void openHomeScreen() {
        Activity activity = getActivity();
        if (activity != null) {
            try {
                activity.moveTaskToBack(true);
            } catch (Exception ignored) {
                // Fall through to an explicit HOME intent.
            }
        }

        try {
            Intent home = new Intent(Intent.ACTION_MAIN);
            home.addCategory(Intent.CATEGORY_HOME);
            home.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(home);
        } catch (Exception error) {
            Log.w(TAG, "Could not explicitly open Home", error);
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
                openHomeScreen();

                // Phase 1: remove the old launcher entry first. A short interval with
                // no launcher entry makes One UI drop its stale component/icon cache.
                mainHandler.postDelayed(() -> {
                    try {
                        if (previousComponent != null && !previousComponent.equals(selectedComponent)) {
                            setState(previousComponent, PackageManager.COMPONENT_ENABLED_STATE_DISABLED);
                        }
                        disableEveryLauncherExcept(selectedComponent);
                    } catch (Exception error) {
                        Log.e(TAG, "Could not remove previous launcher component", error);
                    }

                    // Phase 2: add exactly one new launcher component with its own
                    // DANDULI drawable. Then exit this process after PackageManager
                    // has committed the state so the next launch starts cleanly.
                    mainHandler.postDelayed(() -> {
                        try {
                            setState(selectedComponent, PackageManager.COMPONENT_ENABLED_STATE_ENABLED);
                            disableEveryLauncherExcept(selectedComponent);

                            // Resolve the icon once through PackageManager. This also
                            // verifies the selected component has a real icon resource.
                            getContext().getPackageManager().getActivityIcon(componentFor(selectedComponent));
                            Log.i(TAG, "Launcher icon switched to " + selectedComponent);
                        } catch (Exception error) {
                            Log.e(TAG, "Could not enable selected launcher component", error);
                            try {
                                setState(DEFAULT_COMPONENT, PackageManager.COMPONENT_ENABLED_STATE_ENABLED);
                            } catch (Exception ignored) {
                                // Keep the plugin from crashing even if recovery fails.
                            }
                        } finally {
                            swapInProgress = false;
                        }

                        mainHandler.postDelayed(
                                () -> Process.killProcess(Process.myPid()),
                                PROCESS_EXIT_DELAY_MS
                        );
                    }, ADD_NEW_DELAY_MS);
                }, REMOVE_OLD_DELAY_MS);
            }, GO_HOME_DELAY_MS);
        } catch (Exception error) {
            swapInProgress = false;
            call.reject("ICON_CHANGE_FAILED", error);
        }
    }
}
