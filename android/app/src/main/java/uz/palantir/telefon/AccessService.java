package uz.palantir.telefon;

import android.accessibilityservice.AccessibilityService;
import android.view.accessibility.AccessibilityEvent;

/**
 * Hech narsa qilmaydi. Android 10+ qo'ng'iroq paytida mikrofonni oddiy ilovaga jim beradi; «Maxsus imkoniyatlar» xizmati yoqilgan
 * ilovaga esa ochiq — shuning uchun bor
 */
public class AccessService extends AccessibilityService {
    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) { }

    @Override
    public void onInterrupt() { }
}
