package com.route.couple;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Heal launcher component state before Capacitor starts. This is harmless
        // on normal launches and protects update installs where an old alias state
        // could otherwise leave ROUTE without a usable launcher entry.
        LauncherRepairReceiver.ensureLauncherAvailable(this);
        registerPlugin(AppIconPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
