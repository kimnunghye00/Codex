package com.e2.danduli;

import android.content.Context;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

final class BackgroundLocationUploader {
    private static final int CONNECT_TIMEOUT_MS = 10_000;
    private static final int READ_TIMEOUT_MS = 15_000;
    private static final int MAX_BATCH = 24;

    private BackgroundLocationUploader() {}

    static boolean uploadPending(Context context) {
        BackgroundLocationCredentials.Value credentials = BackgroundLocationCredentials.load(context);
        if (credentials == null) return false;

        JSONArray pending = BackgroundLocationStore.peek(context, MAX_BATCH);
        if (pending.length() == 0) return true;

        HttpURLConnection connection = null;
        try {
            URL url = new URL(credentials.endpoint);
            if (!"https".equalsIgnoreCase(url.getProtocol())) return false;

            JSONObject body = new JSONObject();
            body.put("coupleId", credentials.coupleId);
            body.put("ownerUid", credentials.ownerUid);
            body.put("secret", credentials.secret);
            body.put("points", pending);

            byte[] bytes = body.toString().getBytes(StandardCharsets.UTF_8);
            connection = (HttpURLConnection) url.openConnection();
            connection.setConnectTimeout(CONNECT_TIMEOUT_MS);
            connection.setReadTimeout(READ_TIMEOUT_MS);
            connection.setRequestMethod("POST");
            connection.setDoOutput(true);
            connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            connection.setRequestProperty("Accept", "application/json");
            connection.setFixedLengthStreamingMode(bytes.length);

            try (OutputStream output = connection.getOutputStream()) {
                output.write(bytes);
                output.flush();
            }

            int status = connection.getResponseCode();
            if (status < 200 || status >= 300) {
                // Consume the small error body so the connection can close cleanly.
                try (BufferedInputStream ignored = new BufferedInputStream(connection.getErrorStream())) {
                    byte[] buffer = new byte[512];
                    while (ignored.read(buffer) != -1) { /* discard */ }
                } catch (Exception ignored) {}
                return false;
            }

            BackgroundLocationStore.drop(context, pending.length());
            return true;
        } catch (Exception ignored) {
            return false;
        } finally {
            if (connection != null) connection.disconnect();
        }
    }
}
