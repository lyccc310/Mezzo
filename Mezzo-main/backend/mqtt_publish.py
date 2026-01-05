#!/usr/bin/env python3
import sys
import json
import time
import argparse
import random
from datetime import datetime, timezone
import paho.mqtt.client as mqtt

# MQTT Configuration
MQTT_BROKER = "118.163.141.80"
MQTT_PORT = 1883
MQTT_KEEPALIVE = 60

# Topics
TOPIC_CAMERA_CONTROL = "camera/control"
TOPIC_CAMERA_STATUS = "camera/status"
TOPIC_CAMERA_GPS = "camera/gps"
TOPIC_COT_MESSAGE = "cot/message"
TOPIC_DEVICE_STATUS = "device/{}/status"

class MQTTPublisher:
    def __init__(self, broker=MQTT_BROKER, port=MQTT_PORT):
        self.broker = broker
        self.port = port
        self.client = mqtt.Client()
        self.connected = False
        
        # Callbacks
        self.client.on_connect = self.on_connect
        self.client.on_disconnect = self.on_disconnect
        self.client.on_publish = self.on_publish
        
    def on_connect(self, client, userdata, flags, rc):
        if rc == 0:
            self.connected = True
            print(f"✅ Connected to MQTT Broker: {self.broker}:{self.port}")
        else:
            print(f"❌ Failed to connect, return code {rc}")
            
    def on_disconnect(self, client, userdata, rc):
        self.connected = False
        print(f"🔌 Disconnected from MQTT Broker")
        
    def on_publish(self, client, userdata, mid):
        print(f"📤 Message published (mid: {mid})")
    
    def connect(self):
        try:
            self.client.connect(self.broker, self.port, MQTT_KEEPALIVE)
            self.client.loop_start()
            
            # Wait for connection
            timeout = 5
            start_time = time.time()
            while not self.connected and (time.time() - start_time) < timeout:
                time.sleep(0.1)
                
            if not self.connected:
                print("⚠️ Connection timeout")
                return False
            return True
        except Exception as e:
            print(f"❌ Connection error: {e}")
            return False
    
    def disconnect(self):
        self.client.loop_stop()
        self.client.disconnect()
    
    def publish_camera_command(self, action, device_id="camera_1"):
        """發布攝像頭控制指令"""
        payload = {
            "action": action,
            "deviceId": device_id,
            "timestamp": datetime.now(timezone.utc).isoformat()
        }
        
        result = self.client.publish(
            TOPIC_CAMERA_CONTROL,
            json.dumps(payload),
            qos=1
        )
        
        print(f"📸 Camera command published: {action}")
        return result.is_published()
    
    def publish_gps_update(self, lat, lon, alt=0, device_id="camera_1"):
        """發布 GPS 位置更新"""
        payload = {
            "deviceId": device_id,
            "latitude": lat,
            "longitude": lon,
            "altitude": alt,
            "accuracy": 10.0,
            "timestamp": datetime.now(timezone.utc).isoformat()
        }
        
        result = self.client.publish(
            TOPIC_CAMERA_GPS,
            json.dumps(payload),
            qos=1
        )
        
        print(f"📍 GPS update published: {lat}, {lon}")
        return result.is_published()
    
    def publish_device_status(self, device_id, status="active", battery=None, signal=None):
        """發布設備狀態"""
        payload = {
            "deviceId": device_id,
            "status": status,
            "timestamp": datetime.now(timezone.utc).isoformat()
        }
        
        if battery is not None:
            payload["battery"] = battery
        if signal is not None:
            payload["signal"] = signal
        
        topic = TOPIC_DEVICE_STATUS.format(device_id)
        result = self.client.publish(
            topic,
            json.dumps(payload),
            qos=1
        )
        
        print(f"📊 Device status published: {device_id} - {status}")
        return result.is_published()
    
    def publish_cot_message(self, uid, lat, lon, alt=0, cot_type="a-f-G-U-C", 
                           callsign="Unknown", remarks=""):
        """發布 CoT (Cursor on Target) 消息"""
        now = datetime.now(timezone.utc)
        stale = datetime.fromtimestamp(now.timestamp() + 300, timezone.utc)  # 5 minutes
        
        cot_xml = f'''<?xml version="1.0" encoding="UTF-8"?>
<event version="2.0" uid="{uid}" type="{cot_type}" how="h-e" 
       time="{now.isoformat()}" start="{now.isoformat()}" stale="{stale.isoformat()}">
  <point lat="{lat}" lon="{lon}" hae="{alt}" ce="9999999.0" le="9999999.0"/>
  <detail>
    <contact callsign="{callsign}"/>
    <remarks>{remarks}</remarks>
    <status battery="85" />
    <precisionlocation geopointsrc="GPS" altsrc="GPS"/>
  </detail>
</event>'''
        
        result = self.client.publish(
            TOPIC_COT_MESSAGE,
            cot_xml,
            qos=1
        )
        
        print(f"🎯 CoT message published: {uid} ({callsign})")
        return result.is_published()
    
    def simulate_device_stream(self, device_id, lat, lon, duration=60, interval=5):
        """模擬設備數據流"""
        print(f"🔄 Starting device simulation: {device_id}")
        print(f"   Duration: {duration}s, Interval: {interval}s")
        
        start_time = time.time()
        count = 0
        
        while (time.time() - start_time) < duration:
            # Random walk
            lat += random.uniform(-0.0001, 0.0001)
            lon += random.uniform(-0.0001, 0.0001)
            alt = random.uniform(0, 100)
            
            battery = max(0, 100 - count * 2)
            signal = random.randint(60, 100)
            
            # Publish GPS
            self.publish_gps_update(lat, lon, alt, device_id)
            
            # Publish status
            status = "active" if battery > 20 else "warning"
            self.publish_device_status(device_id, status, battery, signal)
            
            # Publish CoT
            self.publish_cot_message(
                uid=device_id,
                lat=lat,
                lon=lon,
                alt=alt,
                callsign=f"Device-{device_id}",
                remarks=f"Simulated device at iteration {count}"
            )
            
            count += 1
            print(f"   Iteration {count}: Position updated")
            time.sleep(interval)
        
        print(f"✅ Simulation completed: {count} iterations")


def main():
    parser = argparse.ArgumentParser(description='MQTT Publisher for CivTAK/ATAK Integration')
    parser.add_argument('command', nargs='?', default='status',
                       help='Command: left, right, capture, status, gps, cot, simulate')
    parser.add_argument('--device-id', default='camera_1',
                       help='Device ID (default: camera_1)')
    parser.add_argument('--lat', type=float, default=24.993861,
                       help='Latitude (default: 24.993861)')
    parser.add_argument('--lon', type=float, default=121.2995,
                       help='Longitude (default: 121.2995)')
    parser.add_argument('--alt', type=float, default=0,
                       help='Altitude (default: 0)')
    parser.add_argument('--callsign', default='Unknown',
                       help='Callsign for CoT message')
    parser.add_argument('--duration', type=int, default=60,
                       help='Simulation duration in seconds (default: 60)')
    parser.add_argument('--interval', type=int, default=5,
                       help='Simulation interval in seconds (default: 5)')
    
    args = parser.parse_args()
    
    # Create publisher
    publisher = MQTTPublisher()
    
    if not publisher.connect():
        print("❌ Failed to connect to MQTT broker")
        sys.exit(1)
    
    try:
        # Process command
        if args.command in ['left', 'right', 'capture']:
            publisher.publish_camera_command(args.command, args.device_id)
            
        elif args.command == 'status':
            publisher.publish_device_status(
                args.device_id,
                status='active',
                battery=random.randint(70, 100),
                signal=random.randint(80, 100)
            )
            
        elif args.command == 'gps':
            publisher.publish_gps_update(
                args.lat, args.lon, args.alt, args.device_id
            )
            
        elif args.command == 'cot':
            publisher.publish_cot_message(
                uid=args.device_id,
                lat=args.lat,
                lon=args.lon,
                alt=args.alt,
                callsign=args.callsign
            )
            
        elif args.command == 'simulate':
            publisher.simulate_device_stream(
                args.device_id,
                args.lat,
                args.lon,
                duration=args.duration,
                interval=args.interval
            )
            
        else:
            print(f"⚠️ Unknown command: {args.command}")
            print("Available commands: left, right, capture, status, gps, cot, simulate")
        
        # Wait a bit for messages to be sent
        time.sleep(1)
        
    except KeyboardInterrupt:
        print("\n⚠️ Interrupted by user")
    except Exception as e:
        print(f"❌ Error: {e}")
    finally:
        publisher.disconnect()
        print("👋 Disconnected")


if __name__ == "__main__":
    # For backward compatibility with simple command line usage
    if len(sys.argv) == 2 and sys.argv[1] in ['left', 'right', 'capture']:
        publisher = MQTTPublisher()
        if publisher.connect():
            publisher.publish_camera_command(sys.argv[1])
            time.sleep(1)
            publisher.disconnect()
    else:
        main()