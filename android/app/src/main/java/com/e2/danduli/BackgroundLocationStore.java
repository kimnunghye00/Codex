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
    private static final int MAX_POINTS = 2880;

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

    static synchronized JSONArray peek(Context context, int limit) {
        JSONArray source;
        try {
            source = new JSONArray(preferences(context).getString(KEY_QUEUE, "[]"));
        } catch (Exception ignored) {
            source = new JSONArray();
        }
        JSONArray result = new JSONArray();
        int count = Math.min(Math.max(0, limit), source.length());
        for (int index = 0; index < count; index++) {
            Object value = source.opt(index);
            if (value != null) result.put(value);
        }
        return result;
    }

    static synchronized void drop(Context context, int count) {
        SharedPreferences prefs = preferences(context);
        JSONArray source;
        try {
            source = new JSONArray(prefs.getString(KEY_QUEUE, "[]"));
        } catch (Exception ignored) {
            source = new JSONArray();
        }

        int remove = Math.min(Math.max(0, count), source.length());
        JSONArray remaining = new JSONArray();
        for (int index = remove; index < source.length(); index++) {
            Object value = source.opt(index);
            if (value != null) remaining.put(value);
        }
        prefs.edit().putString(KEY_QUEUE, remaining.toString()).apply();
    }

    static synchronized JSONArray drain(Context context) {
        JSONArray queue = peek(context, MAX_POINTS);
        drop(context, queue.length());
        return queue;
    }
}
