package com.trackmenow

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.widget.*
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

class MainActivity : Activity() {
    private val exec=Executors.newSingleThreadExecutor()
    private lateinit var api: EditText
    private lateinit var phone: EditText
    private lateinit var status: TextView
    private var deviceId=""
    private var deviceToken=""

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val box=LinearLayout(this).apply{orientation=LinearLayout.VERTICAL;setPadding(36,48,36,36)}
        val title=TextView(this).apply{text="TRACKMENOW — Mobile Companion";textSize=22f}
        api=EditText(this).apply{hint="API URL";setText("https://wispy-bush-9aee.recreationeeraj.workers.dev")}
        phone=EditText(this).apply{hint="Your mobile number";inputType=3}
        val consent=CheckBox(this).apply{text="I am the device owner and consent to GPS + mobile-network telemetry."}
        val register=Button(this).apply{text="Register this phone"}
        val start=Button(this).apply{text="START LIVE LOCATION";isEnabled=false}
        status=TextView(this).apply{text="Not registered";textSize=15f}
        box.addView(title);box.addView(api);box.addView(phone);box.addView(consent);box.addView(register);box.addView(start);box.addView(status);setContentView(box)

        register.setOnClickListener {
            if(!consent.isChecked){status.text="Consent is required.";return@setOnClickListener}
            registerDevice(phone.text.toString(),api.text.toString().trimEnd('/')){id,token,code,msg->
                deviceId=id;deviceToken=token;status.text="Registered. Pairing code: $code
$msg";start.isEnabled=true
            }
        }
        start.setOnClickListener {
            if(!hasPermissions()){requestPermissions();return@setOnClickListener}
            val i=Intent(this,TrackingService::class.java).apply{putExtra("api",api.text.toString().trimEnd('/'));putExtra("deviceId",deviceId);putExtra("deviceToken",deviceToken)}
            ContextCompat.startForegroundService(this,i);status.text="LIVE GPS + LIVE RADIO running with consent."
        }
    }
    private fun hasPermissions()=ContextCompat.checkSelfPermission(this,Manifest.permission.ACCESS_FINE_LOCATION)==PackageManager.PERMISSION_GRANTED&&ContextCompat.checkSelfPermission(this,Manifest.permission.READ_PHONE_STATE)==PackageManager.PERMISSION_GRANTED
    private fun requestPermissions()=ActivityCompat.requestPermissions(this,arrayOf(Manifest.permission.ACCESS_FINE_LOCATION,Manifest.permission.ACCESS_COARSE_LOCATION,Manifest.permission.READ_PHONE_STATE,Manifest.permission.READ_PHONE_NUMBERS,Manifest.permission.POST_NOTIFICATIONS),100)

    private fun registerDevice(number:String,base:String,cb:(String,String,String,String)->Unit)=exec.execute{
        try{
            val safe=number.replace(""","")
            val body="{"phone":"$safe","label":"Android TrackMeNow","consent":true}"
            val c=URL(base+"/api/devices/register").openConnection() as HttpURLConnection
            c.requestMethod="POST";c.doOutput=true;c.setRequestProperty("Content-Type","application/json")
            c.outputStream.use{it.write(body.toByteArray())}
            val text=(if(c.responseCode<400)c.inputStream else c.errorStream).bufferedReader().readText()
            val id=Regex(""deviceId"\s*:\s*"([^"]+)"").find(text)?.groupValues?.get(1)?:throw Exception(text)
            val token=Regex(""deviceToken"\s*:\s*"([^"]+)"").find(text)?.groupValues?.get(1)?:throw Exception(text)
            val code=Regex(""pairingCode"\s*:\s*"([^"]+)"").find(text)?.groupValues?.get(1)?:""
            runOnUiThread{cb(id,token,code,"Enter that code in TrackMeNow to authorize viewing.")}
        }catch(e:Exception){runOnUiThread{status.text="Registration failed: ${e.message}"}}
    }
}
