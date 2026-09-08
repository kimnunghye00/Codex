package com.route.couple;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.webkit.MimeTypeMap;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.BufferedInputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

@CapacitorPlugin(name = "RouteMediaSaver")
public class MediaSaverPlugin extends Plugin {
    @PluginMethod
    public void saveImage(PluginCall call) {
        String sourceUrl = call.getString("url");
        String requestedName = call.getString("fileName", "ROUTE-photo.jpg");
        if (sourceUrl == null || sourceUrl.trim().isEmpty()) {
            call.reject("MEDIA_URL_REQUIRED");
            return;
        }

        getBridge().executeOnThreadPool(() -> {
            HttpURLConnection connection = null;
            Uri inserted = null;
            try {
                URL url = new URL(sourceUrl);
                connection = (HttpURLConnection) url.openConnection();
                connection.setConnectTimeout(15000);
                connection.setReadTimeout(30000);
                connection.setInstanceFollowRedirects(true);
                connection.connect();
                int status = connection.getResponseCode();
                if (status < 200 || status >= 300) throw new IllegalStateException("HTTP_" + status);

                String contentType = connection.getContentType();
                if (contentType == null || !contentType.startsWith("image/")) contentType = "image/jpeg";
                String extension = MimeTypeMap.getSingleton().getExtensionFromMimeType(contentType);
                if (extension == null || extension.isEmpty()) extension = "jpg";
                String fileName = requestedName.matches(".*\\.[A-Za-z0-9]{2,5}$")
                        ? requestedName.replaceFirst("\\.[A-Za-z0-9]{2,5}$", "." + extension)
                        : requestedName + "." + extension;

                ContentResolver resolver = getContext().getContentResolver();
                ContentValues values = new ContentValues();
                values.put(MediaStore.Images.Media.DISPLAY_NAME, fileName);
                values.put(MediaStore.Images.Media.MIME_TYPE, contentType);
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    values.put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/ROUTE");
                    values.put(MediaStore.Images.Media.IS_PENDING, 1);
                }

                inserted = resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values);
                if (inserted == null) throw new IllegalStateException("MEDIASTORE_INSERT_FAILED");

                try (BufferedInputStream input = new BufferedInputStream(connection.getInputStream());
                     OutputStream output = resolver.openOutputStream(inserted, "w")) {
                    if (output == null) throw new IllegalStateException("MEDIASTORE_OUTPUT_FAILED");
                    byte[] buffer = new byte[16 * 1024];
                    int read;
                    while ((read = input.read(buffer)) != -1) output.write(buffer, 0, read);
                    output.flush();
                }

                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    ContentValues publish = new ContentValues();
                    publish.put(MediaStore.Images.Media.IS_PENDING, 0);
                    resolver.update(inserted, publish, null, null);
                }

                JSObject result = new JSObject();
                result.put("saved", true);
                result.put("uri", inserted.toString());
                call.resolve(result);
            } catch (Exception error) {
                if (inserted != null) {
                    try { getContext().getContentResolver().delete(inserted, null, null); } catch (Exception ignored) {}
                }
                call.reject("MEDIA_SAVE_FAILED", error);
            } finally {
                if (connection != null) connection.disconnect();
            }
        });
    }
}
