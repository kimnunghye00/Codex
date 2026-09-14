package com.route.couple;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import android.app.Instrumentation;
import android.os.ParcelFileDescriptor;
import android.webkit.WebView;

import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import org.junit.Test;
import org.junit.runner.RunWith;

import java.io.FileInputStream;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

@RunWith(AndroidJUnit4.class)
public class AndroidReleaseReadinessTest {
    private static final long PAGE_TIMEOUT_SECONDS = 15;

    private String evaluate(WebView webView, String script) throws Exception {
        CountDownLatch latch = new CountDownLatch(1);
        AtomicReference<String> result = new AtomicReference<>();
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() ->
            webView.evaluateJavascript(script, value -> {
                result.set(value);
                latch.countDown();
            })
        );
        assertTrue("JavaScript result timed out", latch.await(PAGE_TIMEOUT_SECONDS, TimeUnit.SECONDS));
        return result.get();
    }

    private WebView awaitWebView(ActivityScenario<MainActivity> scenario) throws Exception {
        AtomicReference<WebView> target = new AtomicReference<>();
        long deadline = System.currentTimeMillis() + PAGE_TIMEOUT_SECONDS * 1000;
        while (System.currentTimeMillis() < deadline) {
            scenario.onActivity(activity -> target.set(activity.getBridge().getWebView()));
            WebView webView = target.get();
            if (webView != null && "\"complete\"".equals(evaluate(webView, "document.readyState"))) return webView;
            Thread.sleep(200);
        }
        throw new AssertionError("단둘이 WebView did not finish loading");
    }

    private void shell(String command) throws Exception {
        ParcelFileDescriptor descriptor = InstrumentationRegistry.getInstrumentation().getUiAutomation().executeShellCommand(command);
        try (FileInputStream ignored = new FileInputStream(descriptor.getFileDescriptor())) {
            while (ignored.read() != -1) { /* drain command output */ }
        }
    }

    @Test
    public void appStartsWhenRuntimePermissionsAreDenied() throws Exception {
        for (String permission : new String[]{
            "android.permission.CAMERA",
            "android.permission.RECORD_AUDIO",
            "android.permission.ACCESS_FINE_LOCATION",
            "android.permission.ACCESS_COARSE_LOCATION",
            "android.permission.POST_NOTIFICATIONS"
        }) {
            shell("pm revoke com.route.couple " + permission);
        }

        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            WebView webView = awaitWebView(scenario);
            String text = evaluate(webView, "document.body.innerText.includes('단둘이')");
            assertEquals("true", text);
        }
    }

    @Test
    public void koreanCompositionSurvivesControlledInputRewrite() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            WebView webView = awaitWebView(scenario);
            String value = evaluate(webView,
                "new Promise(resolve=>{" +
                "const i=document.createElement('textarea');document.body.append(i);" +
                "i.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true,data:'한'}));" +
                "i.value='한글 입력';i.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertCompositionText',data:'한글 입력',isComposing:true}));" +
                "i.value='';setTimeout(()=>resolve(i.value),80);})");
            assertEquals("\"한글 입력\"", value);
        }
    }

    @Test
    public void hardwareBackClosesTopDialogBeforeLeavingApp() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            WebView webView = awaitWebView(scenario);
            evaluate(webView,
                "(()=>{const d=document.createElement('div');d.setAttribute('role','dialog');" +
                "const b=document.createElement('button');b.setAttribute('aria-label','닫기');" +
                "b.onclick=()=>{window.__danduliBackClosed=true;d.remove()};d.append(b);document.body.append(d);return true})()");

            scenario.onActivity(activity -> activity.getOnBackPressedDispatcher().onBackPressed());
            Thread.sleep(250);
            assertEquals("true", evaluate(webView, "window.__danduliBackClosed===true"));
        }
    }

    @Test
    public void smsAuthenticationEntryPointIsPresent() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            WebView webView = awaitWebView(scenario);
            String result = evaluate(webView,
                "(()=>{const buttons=[...document.querySelectorAll('button')];" +
                "const signup=buttons.find(b=>b.textContent.includes('회원가입'));signup?.click();" +
                "return new Promise(r=>setTimeout(()=>r(Boolean(document.querySelector('input[type=tel][autocomplete=tel]'))),100))})()");
            assertEquals("true", result);
            assertNotNull(webView);
        }
    }
}
