package com.trackmenow

import android.Manifest
import android.app.*
import android.content.Context
import android.content.pm.PackageManager
import android.location.*
import android.os.IBinder
import android.telephony.*
import androidx.core.app.ActivityCompat
import java.net.HttpURLConnection
import java.net.URL
import java.time.Instant
import java.util.concurrent.Executors

class TrackingService : Service() {
    private val exec=Executors.newSingleThreadExecutor()
    private lateinit var lm:LocationManager
    private var api=""; private var deviceId=""; private var token=""

    override fun onStartCommand(i:android.content.Intent?, flags:Int, startId:Int):Int {
        api=i?.getStringExtra("api")?:api
        deviceId=i?.getStringExtra("deviceId")?:deviceId
        token=i?.getStringExtra("deviceToken")?:token
        val channel="trackmenow-live"
        val nm=getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel(channel,"TrackMeNow Live",NotificationManager.IMPORTANCE_LOW))
        startForeground(7,Notification.Builder(this,channel).setContentTitle("TrackMeNow live tracking").setContentText("GPS + mobile-network telemetry is active").setSmallIcon(android.R.drawable.ic_menu_mylocation).build())
        startUpdates()
        return START_STICKY
    }

    private fun startUpdates() {
        lm=getSystemService(Context.LOCATION_SERVICE) as LocationManager
        if(ActivityCompat.checkSelfPermission(this,Manifest.permission.ACCESS_FINE_LOCATION)!=PackageManager.PERMISSION_GRANTED)return
        val listener=object:LocationListener{
            override fun onLocationChanged(l:Location){send(l,readRadio())}
            override fun onProviderEnabled(p:String){}
            override fun onProviderDisabled(p:String){}
        }
        try{lm.requestLocationUpdates(LocationManager.GPS_PROVIDER,5000L,0.0f,listener)}catch(_:Exception){}
        try{lm.requestLocationUpdates(LocationManager.NETWORK_PROVIDER,10000L,0.0f,listener)}catch(_:Exception){}
    }

    private fun readRadio():Map<String,Any?> {
        val out=mutableMapOf<String,Any?>()
        val tm=getSystemService(TelephonyManager::class.java)
        if(ActivityCompat.checkSelfPermission(this,Manifest.permission.ACCESS_FINE_LOCATION)!=PackageManager.PERMISSION_GRANTED)return out
        try {
            val cells=tm.allCellInfo?:emptyList()
            val c=cells.firstOrNull{it.isRegistered}?:cells.firstOrNull()
            when(c) {
                is CellInfoLte -> { val x=c.cellIdentity; val s=c.cellSignalStrength; out["rat"]="LTE"; out["mcc"]=x.mccString?.toIntOrNull(); out["mnc"]=x.mncString?.toIntOrNull(); out["tac"]=x.tac; out["cellId"]=x.ci; out["pci"]=x.pci; out["earfcn"]=x.earfcn; out["rsrp"]=s.rsrp; out["rsrq"]=s.rsrq; out["rssi"]=s.rssi }
                is CellInfoNr -> { val x=c.cellIdentity as CellIdentityNr; val s=c.cellSignalStrength as CellSignalStrengthNr; out["rat"]="NR"; out["mcc"]=x.mccString?.toIntOrNull(); out["mnc"]=x.mncString?.toIntOrNull(); out["tac"]=x.tac; out["nci"]=x.nci; out["pci"]=x.pci; out["nrarfcn"]=x.nrarfcn; out["ssRsrp"]=s.ssRsrp; out["ssRsrq"]=s.ssRsrq; out["ssSinr"]=s.ssSinr }
                is CellInfoWcdma -> { val x=c.cellIdentity; val s=c.cellSignalStrength; out["rat"]="UMTS"; out["mcc"]=x.mccString?.toIntOrNull(); out["mnc"]=x.mncString?.toIntOrNull(); out["lac"]=x.lac; out["cellId"]=x.cid; out["psc"]=x.psc; out["rscp"]=s.dbm }
                is CellInfoGsm -> { val x=c.cellIdentity; val s=c.cellSignalStrength; out["rat"]="GSM"; out["mcc"]=x.mccString?.toIntOrNull(); out["mnc"]=x.mncString?.toIntOrNull(); out["lac"]=x.lac; out["cellId"]=x.cid; out["arfcn"]=x.arfcn; out["bsic"]=x.bsic; out["rssi"]=s.dbm }
            }
        }catch(_:Exception){}
        return out
    }

    private fun send(l:Location,radio:Map<String,Any?>) {
        exec.execute {
            try {
                fun jsonValue(v:Any?)=when(v){null->"null";is Number,is Boolean->v.toString();else->"\"" + v.toString().replace("\"","") + "\""}
                val radioJson=radio.entries.joinToString(","){(k,v)->"\"" + k + "\":" + jsonValue(v)}
                val body="{\"timestamp\":\"" + Instant.now().toString() + "\",\"lat\":" + l.latitude + ",\"lon\":" + l.longitude + ",\"accuracy\":" + l.accuracy + ",\"altitude\":" + (if(l.hasAltitude()) l.altitude else "null") + ",\"speed\":" + (if(l.hasSpeed()) l.speed else "null") + ",\"heading\":" + (if(l.hasBearing()) l.bearing else "null") + ",\"radio\":{" + radioJson + "}}"
                val c=URL(api+"/api/devices/"+deviceId+"/telemetry").openConnection() as HttpURLConnection
                c.requestMethod="POST"; c.doOutput=true; c.setRequestProperty("Content-Type","application/json"); c.setRequestProperty("Authorization","Bearer "+token)
                c.outputStream.use{it.write(body.toByteArray())}; c.inputStream.close()
            }catch(_:Exception){}
        }
    }

    override fun onBind(i:android.content.Intent?):IBinder?=null
    override fun onDestroy(){exec.shutdownNow();super.onDestroy()}
}
