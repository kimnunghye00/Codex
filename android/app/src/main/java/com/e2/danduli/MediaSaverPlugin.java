package com.e2.danduli;

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
import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
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

        new Thread(() -> {
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
        }, "route-media-saver").start();
    }

    @PluginMethod
    public void saveVideo(PluginCall call) {
        String sourceUri = call.getString("uri", "").trim();
        String requestedName = call.getString("fileName", "DANDULI-footprint.webm").trim();
        String requestedMimeType = call.getString("mimeType", "video/webm").trim();
        if (sourceUri.isEmpty()) {
            call.reject("VIDEO_URI_REQUIRED");
            return;
        }
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            call.reject("VIDEO_SAVE_REQUIRES_ANDROID_10");
            return;
        }

        final String contentType = requestedMimeType.split(";", 2)[0].trim().toLowerCase();
        if (!"video/mp4".equals(contentType) && !"video/webm".equals(contentType)) {
            call.reject("VIDEO_MIME_UNSUPPORTED");
            return;
        }
        final String extension = "video/mp4".equals(contentType) ? "mp4" : "webm";
        final String fileName = requestedName.matches(".*\\.[A-Za-z0-9]{2,5}$")
                ? requestedName.replaceFirst("\\.[A-Za-z0-9]{2,5}$", "." + extension)
                : requestedName + "." + extension;

        new Thread(() -> {
            ContentResolver resolver = getContext().getContentResolver();
            Uri inserted = null;
            try {
                ContentValues values = new ContentValues();
                values.put(MediaStore.Video.Media.DISPLAY_NAME, fileName);
                values.put(MediaStore.Video.Media.MIME_TYPE, contentType);
                values.put(MediaStore.Video.Media.RELATIVE_PATH, Environment.DIRECTORY_MOVIES + "/DANDULI");
                values.put(MediaStore.Video.Media.IS_PENDING, 1);

                inserted = resolver.insert(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, values);
                if (inserted == null) throw new IllegalStateException("VIDEO_MEDIASTORE_INSERT_FAILED");

                Uri parsedSource = Uri.parse(sourceUri);
                InputStream source;
                if ("file".equalsIgnoreCase(parsedSource.getScheme())) {
                    String path = parsedSource.getPath();
                    if (path == null || path.trim().isEmpty()) throw new IllegalStateException("VIDEO_SOURCE_PATH_REQUIRED");
                    source = new FileInputStream(new File(path));
                } else {
                    source = resolver.openInputStream(parsedSource);
                }
                if (source == null) throw new IllegalStateException("VIDEO_SOURCE_OPEN_FAILED");

                try (InputStream input = new BufferedInputStream(source);
                     OutputStream output = resolver.openOutputStream(inserted, "w")) {
                    if (output == null) throw new IllegalStateException("VIDEO_MEDIASTORE_OUTPUT_FAILED");
                    byte[] buffer = new byte[32 * 1024];
                    int read;
                    while ((read = input.read(buffer)) != -1) output.write(buffer, 0, read);
                    output.flush();
                }

                ContentValues publish = new ContentValues();
                publish.put(MediaStore.Video.Media.IS_PENDING, 0);
                resolver.update(inserted, publish, null, null);

                JSObject result = new JSObject();
                result.put("saved", true);
                result.put("uri", inserted.toString());
                result.put("fileName", fileName);
                call.resolve(result);
            } catch (Exception error) {
                if (inserted != null) {
                    try { resolver.delete(inserted, null, null); } catch (Exception ignored) {}
                }
                call.reject("VIDEO_SAVE_FAILED", error);
            }
        }, "danduli-video-saver").start();
    }

}
