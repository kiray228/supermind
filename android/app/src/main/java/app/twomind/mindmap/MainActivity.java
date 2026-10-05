package app.twomind.mindmap;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SmCalendarPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
