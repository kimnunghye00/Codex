package com.e2.danduli;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Build;
import android.os.IBinder;
import android.os.Looper;

import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class BackgroundLocationService extends Service implements LocationListener {
    static final String ACTION_LOCATION = "com.e2.danduli.BACKGROUND_LOCATION";
    static final String ACTION_STOP = "com.e2.danduli.STOP_BACKGROUND_LOCATION";
    private static final String CHANNEL_ID = "danduli_footprints";
    private static final int NOTIFICATION_ID = 2407;
    private static final long NETWORK_INTERVAL_MS = 60_000L;
    private static final long GPS_INTERVAL_MS = 90_000L;
    private static final float GPS_MIN_DISTANCE_METERS = 40f;
    private static final float MAX_ACCURACY_METERS = 300f;

    private LocationManager locationManager;
    private long lastAcceptedAt = 0L;
    private double lastLatitude = Double.NaN;
    private double lastLongitude = Double.NaN;
    private ExecutorService uploadExecutor;

    @Override
    public void onCreate() {
        super.onCreate();
        locationManager = (LocationManager) getSystemService(LOCATION_SERVICE);
        uploadExecutor = Executors.newSingleThreadExecutor();
        createNotificationChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            BackgroundLocationStore.setEnabled(this, false);
            stopUpdates();
            stopForeground(STOP_FOREGROUND_REMOVE);
            stopSelf();
            return START_NOT_STICKY;
        }

        startAsForeground();
        BackgroundLocationStore.setEnabled(this, true);
        startUpdates();
        queueUpload();
        return START_STICKY;
    }

    private void startAsForeground() {
        Intent openApp = new Intent(this, MainActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent contentIntent = PendingIntent.getActivity(
                this,
                2407,
                openApp,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        Notification notification = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(android.R.drawable.ic_menu_mylocation)
                .setContentTitle("단둘이 발자취 기록 중")
                .setContentText("위치 공유를 켠 동안 이동 경로를 기록하고 있어요.")
                .setContentIntent(contentIntent)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setCategory(NotificationCompat.CATEGORY_SERVICE)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .build();

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager == null || manager.getNotificationChannel(CHANNEL_ID) != null) return;
        NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "발자취 위치 공유",
                NotificationManager.IMPORTANCE_LOW
        );
        channel.setDescription("위치 공유 중 백그라운드 발자취 기록 상태를 표시합니다.");
        channel.setShowBadge(false);
        manager.createNotificationChannel(channel);
    }

    private boolean hasCoarseLocation() {
        return ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION)
                == PackageManager.PERMISSION_GRANTED;
    }

    private boolean hasFineLocation() {
        return ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION)
                == PackageManager.PERMISSION_GRANTED;
    }

    private void startUpdates() {
        stopUpdates();
        if (locationManager == null || (!hasCoarseLocation() && !hasFineLocation())) {
            stopSelf();
            return;
        }

        try {
            if (locationManager.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) {
                locationManager.requestLocationUpdates(
                        LocationManager.NETWORK_PROVIDER,
                        NETWORK_INTERVAL_MS,
                        0f,
                        this,
                        Looper.getMainLooper()
                );
            }
        } catch (SecurityException | IllegalArgumentException ignored) {}

        if (!hasFineLocation()) return;
        try {
            if (locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER)) {
                locationManager.requestLocationUpdates(
                        LocationManager.GPS_PROVIDER,
                        GPS_INTERVAL_MS,
                        GPS_MIN_DISTANCE_METERS,
                        this,
                        Looper.getMainLooper()
                );
            }
        } catch (SecurityException | IllegalArgumentException ignored) {}
    }

    private void stopUpdates() {
        if (locationManager == null) return;
        try {
            locationManager.removeUpdates(this);
        } catch (SecurityException ignored) {}
    }

    private void queueUpload() {
        ExecutorService executor = uploadExecutor;
        if (executor == null || executor.isShutdown()) return;
        executor.execute(() -> {
            // Drain several small batches without holding the location thread.
            // If the network is unavailable, leave the queue intact for the next
            // location sample or service restart.
            for (int attempt = 0; attempt < 4; attempt++) {
                if (!BackgroundLocationUploader.uploadPending(getApplicationContext())) break;
                if (BackgroundLocationStore.peek(getApplicationContext(), 1).length() == 0) break;
            }
        });
    }

    private static double distanceMeters(double lat1, double lon1, double lat2, double lon2) {
        double radius = 6_371_000d;
        double dLat = Math.toRadians(lat2 - lat1);
        double dLon = Math.toRadians(lon2 - lon1);
        double a = Math.sin(dLat / 2d) * Math.sin(dLat / 2d)
                + Math.cos(Math.toRadians(lat1)) * Math.cos(Math.toRadians(lat2))
                * Math.sin(dLon / 2d) * Math.sin(dLon / 2d);
        return 2d * radius * Math.asin(Math.sqrt(a));
    }

    @Override
    public void onLocationChanged(Location location) {
        if (location == null || !Double.isFinite(location.getLatitude())
                || !Double.isFinite(location.getLongitude())) return;
        if (location.hasAccuracy() && location.getAccuracy() > MAX_ACCURACY_METERS) return;

        long sampleAt = location.getTime() > 0 ? location.getTime() : System.currentTimeMillis();
        if (sampleAt < System.currentTimeMillis() - 10 * 60_000L) return;

        if (Double.isFinite(lastLatitude) && Double.isFinite(lastLongitude)) {
            double moved = distanceMeters(lastLatitude, lastLongitude, location.getLatitude(), location.getLongitude());
            if (sampleAt - lastAcceptedAt < 45_000L && moved < 20d) return;
        }

        lastAcceptedAt = sampleAt;
        lastLatitude = location.getLatitude();
        lastLongitude = location.getLongitude();
        BackgroundLocationStore.append(this, location);
        queueUpload();

        Intent update = new Intent(ACTION_LOCATION)
                .setPackage(getPackageName())
                .putExtra("latitude", location.getLatitude())
                .putExtra("longitude", location.getLongitude())
                .putExtra("accuracy", Math.max(0f, location.getAccuracy()))
                .putExtra("timestamp", sampleAt);
        sendBroadcast(update);
    }

    @Override
    public void onProviderEnabled(String provider) {
        startUpdates();
    }

    @Override
    public void onProviderDisabled(String provider) {
        // Keep the service alive; another provider may still be available.
    }

    @Override
    public void onDestroy() {
        stopUpdates();
        if (uploadExecutor != null) {
            uploadExecutor.shutdownNow();
            uploadExecutor = null;
        }
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
