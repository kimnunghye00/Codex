package com.e2.danduli;

import android.content.Context;
import android.content.SharedPreferences;
import android.location.Location;

import org.json.JSONArray;
import org.json.JSONObject;

final class BackgroundLocationStore {
    private static final String PREFS = "danduli_background_location";
    private static final String KEY_QUEUE = "pending_points";
    private static final String KEY_ENABLED = "enabled";
    private static final int MAX_POINTS = 720;

    private BackgroundLocationStore() {}

    private static SharedPreferences preferences(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static synchronized void setEnabled(Context context, boolean enabled) {
        preferences(context).edit().putBoolean(KEY_ENABLED, enabled).apply();
    }

    static synchronized boolean isEnabled(Context context) {
        return preferences(context).getBoolean(KEY_ENABLED, false);
    }

    static synchronized void append(Context context, Location location) {
        try {
            SharedPreferences prefs = preferences(context);
            JSONArray queue;
            try {
                queue = new JSONArray(prefs.getString(KEY_QUEUE, "[]"));
            } catch (Exception ignored) {
                queue = new JSONArray();
            }

            while (queue.length() >= MAX_POINTS) queue.remove(0);

            JSONObject point = new JSONObject();
            point.put("latitude", location.getLatitude());
            point.put("longitude", location.getLongitude());
            point.put("accuracy", Math.max(0f, location.getAccuracy()));
            point.put("timestamp", location.getTime() > 0 ? location.getTime() : System.currentTimeMillis());
            point.put("background", true);
            if (location.getProvider() != null) point.put("provider", location.getProvider());
            queue.put(point);
            prefs.edit().putString(KEY_QUEUE, queue.toString()).apply();
        } catch (Exception ignored) {
            // A failed cache write must never crash the foreground service.
        }
    }

    static synchronized JSONArray drain(Context context) {
        SharedPreferences prefs = preferences(context);
        JSONArray queue;
        try {
            queue = new JSONArray(prefs.getString(KEY_QUEUE, "[]"));
        } catch (Exception ignored) {
            queue = new JSONArray();
        }
        prefs.edit().putString(KEY_QUEUE, "[]").apply();
        return queue;
    }
}
