package com.e2.danduli;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import org.json.JSONObject;

import java.nio.charset.StandardCharsets;
import java.security.KeyStore;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

final class BackgroundLocationCredentials {
    private static final String PREFS = "danduli_background_location_credentials";
    private static final String KEY_BLOB = "encrypted_blob";
    private static final String KEY_ALIAS = "danduli_location_upload_v1";

    static final class Value {
        final String endpoint;
        final String coupleId;
        final String ownerUid;
        final String secret;

        Value(String endpoint, String coupleId, String ownerUid, String secret) {
            this.endpoint = endpoint;
            this.coupleId = coupleId;
            this.ownerUid = ownerUid;
            this.secret = secret;
        }
    }

    private BackgroundLocationCredentials() {}

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private static SecretKey getOrCreateKey() throws Exception {
        KeyStore keyStore = KeyStore.getInstance("AndroidKeyStore");
        keyStore.load(null);
        if (keyStore.containsAlias(KEY_ALIAS)) {
            return (SecretKey) keyStore.getKey(KEY_ALIAS, null);
        }

        KeyGenerator generator = KeyGenerator.getInstance(
                KeyProperties.KEY_ALGORITHM_AES,
                "AndroidKeyStore"
        );
        generator.init(new KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT
        )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .build());
        return generator.generateKey();
    }

    static synchronized void save(
            Context context,
            String endpoint,
            String coupleId,
            String ownerUid,
            String secret
    ) throws Exception {
        JSONObject payload = new JSONObject();
        payload.put("endpoint", endpoint);
        payload.put("coupleId", coupleId);
        payload.put("ownerUid", ownerUid);
        payload.put("secret", secret);

        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey());
        byte[] cipherText = cipher.doFinal(payload.toString().getBytes(StandardCharsets.UTF_8));
        String iv = Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP);
        String encrypted = Base64.encodeToString(cipherText, Base64.NO_WRAP);
        prefs(context).edit().putString(KEY_BLOB, iv + "." + encrypted).commit();
    }

    static synchronized Value load(Context context) {
        try {
            String blob = prefs(context).getString(KEY_BLOB, "");
            if (blob == null || blob.isEmpty() || !blob.contains(".")) return null;
            String[] parts = blob.split("\\.", 2);
            byte[] iv = Base64.decode(parts[0], Base64.NO_WRAP);
            byte[] cipherText = Base64.decode(parts[1], Base64.NO_WRAP);

            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, getOrCreateKey(), new GCMParameterSpec(128, iv));
            String decoded = new String(cipher.doFinal(cipherText), StandardCharsets.UTF_8);
            JSONObject payload = new JSONObject(decoded);

            String endpoint = payload.optString("endpoint", "").trim();
            String coupleId = payload.optString("coupleId", "").trim();
            String ownerUid = payload.optString("ownerUid", "").trim();
            String secret = payload.optString("secret", "").trim();
            if (!endpoint.startsWith("https://") || coupleId.isEmpty() || ownerUid.isEmpty() || secret.length() < 32) {
                return null;
            }
            return new Value(endpoint, coupleId, ownerUid, secret);
        } catch (Exception ignored) {
            return null;
        }
    }

    static synchronized void clear(Context context) {
        prefs(context).edit().remove(KEY_BLOB).commit();
    }
}
