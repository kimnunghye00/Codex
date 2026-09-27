package com.e2.danduli;

import android.Manifest;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONObject;

@CapacitorPlugin(name = "RouteBackgroundLocation")
public class BackgroundLocationPlugin extends Plugin {
    private boolean receiverRegistered = false;

    private final BroadcastReceiver locationReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            if (intent == null || !BackgroundLocationService.ACTION_LOCATION.equals(intent.getAction())) return;
            JSObject point = new JSObject();
            point.put("latitude", intent.getDoubleExtra("latitude", Double.NaN));
            point.put("longitude", intent.getDoubleExtra("longitude", Double.NaN));
            point.put("accuracy", intent.getFloatExtra("accuracy", 0f));
            point.put("timestamp", intent.getLongExtra("timestamp", System.currentTimeMillis()));
            point.put("background", true);
            notifyListeners("location", point, true);
        }
    };

    @Override
    public void load() {
        super.load();
        IntentFilter filter = new IntentFilter(BackgroundLocationService.ACTION_LOCATION);
        ContextCompat.registerReceiver(
                getContext(),
                locationReceiver,
                filter,
                ContextCompat.RECEIVER_NOT_EXPORTED
        );
        receiverRegistered = true;
    }

    private boolean hasLocationPermission() {
        return ContextCompat.checkSelfPermission(getContext(), Manifest.permission.ACCESS_COARSE_LOCATION)
                == PackageManager.PERMISSION_GRANTED
                || ContextCompat.checkSelfPermission(getContext(), Manifest.permission.ACCESS_FINE_LOCATION)
                == PackageManager.PERMISSION_GRANTED;
    }

    @PluginMethod
    public void start(PluginCall call) {
        if (!hasLocationPermission()) {
            call.reject("LOCATION_PERMISSION_REQUIRED");
            return;
        }

        try {
            Intent intent = new Intent(getContext(), BackgroundLocationService.class);
            ContextCompat.startForegroundService(getContext(), intent);
            JSObject result = new JSObject();
            result.put("running", true);
            call.resolve(result);
        } catch (Exception error) {
            call.reject("BACKGROUND_LOCATION_START_FAILED", error);
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        try {
            BackgroundLocationStore.setEnabled(getContext(), false);
            Intent intent = new Intent(getContext(), BackgroundLocationService.class)
                    .setAction(BackgroundLocationService.ACTION_STOP);
            getContext().stopService(intent);
            JSObject result = new JSObject();
            result.put("running", false);
            call.resolve(result);
        } catch (Exception error) {
            call.reject("BACKGROUND_LOCATION_STOP_FAILED", error);
        }
    }

    @PluginMethod
    public void status(PluginCall call) {
        JSObject result = new JSObject();
        result.put("running", BackgroundLocationStore.isEnabled(getContext()));
        call.resolve(result);
    }

    @PluginMethod
    public void drain(PluginCall call) {
        JSONArray pending = BackgroundLocationStore.drain(getContext());
        JSArray points = new JSArray();
        for (int index = 0; index < pending.length(); index++) {
            JSONObject source = pending.optJSONObject(index);
            if (source == null) continue;
            JSObject point = new JSObject();
            point.put("latitude", source.optDouble("latitude", Double.NaN));
            point.put("longitude", source.optDouble("longitude", Double.NaN));
            point.put("accuracy", source.optDouble("accuracy", 0d));
            point.put("timestamp", source.optLong("timestamp", System.currentTimeMillis()));
            point.put("background", true);
            points.put(point);
        }
        JSObject result = new JSObject();
        result.put("points", points);
        call.resolve(result);
    }

    @Override
    protected void handleOnDestroy() {
        if (receiverRegistered) {
            try {
                getContext().unregisterReceiver(locationReceiver);
            } catch (Exception ignored) {}
            receiverRegistered = false;
        }
        super.handleOnDestroy();
    }
}
