#!/usr/bin/env python3
import paho.mqtt.client as mqtt
import struct
import time

# PTT MQTT Broker
BROKER = "118.163.141.80"
PORT = 1883

def send_ptt_gps(channel, uuid, lat, lon):
    """發送 PTT GPS 訊息"""
    client = mqtt.Client()
    client.connect(BROKER, PORT, 60)
    
    # 建構 PTT 格式
    tag = "GPS".ljust(32, '\0')  # 32 bytes
    uuid_padded = uuid.ljust(128, '\0')  # 128 bytes
    data = f"{uuid},{lat},{lon}"  # Variable length
    
    # 合併成 binary
    message = tag.encode('utf-8') + uuid_padded.encode('utf-8') + data.encode('utf-8')
    
    # 發送
    topic = f"/WJI/PTT/{channel}/GPS"
    client.publish(topic, message)
    print(f"📤 Sent PTT GPS: {topic}")
    print(f"   UUID: {uuid}")
    print(f"   Location: {lat}, {lon}")
    
    client.disconnect()

def send_ptt_sos(channel, uuid, lat, lon):
    """發送 PTT SOS 訊息"""
    client = mqtt.Client()
    client.connect(BROKER, PORT, 60)
    
    tag = "SOS".ljust(32, '\0')
    uuid_padded = uuid.ljust(128, '\0')
    data = f"{lat},{lon}"
    
    message = tag.encode('utf-8') + uuid_padded.encode('utf-8') + data.encode('utf-8')
    
    topic = f"/WJI/PTT/{channel}/SOS"
    client.publish(topic, message)
    print(f"🆘 Sent PTT SOS: {topic}")
    
    client.disconnect()

if __name__ == "__main__":
    # 測試 GPS
    send_ptt_gps("police-team", "user-001", 25.0338, 121.5646)
    time.sleep(1)
    
    # 測試 SOS
    send_ptt_sos("police-team", "user-001", 25.0338, 121.5646)