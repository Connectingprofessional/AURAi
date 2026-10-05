# TrackMeNow Android companion

This native companion is the consented-device layer. The owner enters their own mobile number, explicitly consents to GPS + radio telemetry, receives a one-time pairing code, and can start live tracking.

The app sends GPS plus modem fields Android exposes, such as MCC/MNC, TAC/LAC, Cell ID/ECI/NCI, PCI, EARFCN/NR-ARFCN and signal measurements. Availability varies by Android version, device and carrier.

Android 10+ restricts access to non-resettable identifiers such as IMEI, so TrackMeNow uses its own generated device token instead.

Open the android/ folder in Android Studio, build/install the app, register the consenting phone, then enter the displayed pairing code in the TrackMeNow dashboard.
