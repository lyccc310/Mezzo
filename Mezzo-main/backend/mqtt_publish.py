#!/usr/bin/env python3
import sys
import json
import time
import argparse
import random
from datetime import datetime, timezone
import paho.mqtt.client as mqtt

# ==================== 配置（與 server.cjs 一致）====================
MQTT_BROKER = "test.mosquitto.org"  # 改成跟 server.cjs 一樣
MQTT_PORT = 1883
MQTT_KEEPALIVE = 60

# Topics（與 server.cjs 一致）
TOPIC_PREFIX = "myapp"
TOPIC_CAMERA_CONTROL = f"{TOPIC_PREFIX}/camera/control"
TOPIC_CAMERA_STATUS = f"{TOPIC_PREFIX}/camera/status"
TOPIC_CAMERA_GPS = f"{TOPIC_PREFIX}/camera/gps"
TOPIC_COT_MESSAGE = f"{TOPIC_PREFIX}/cot/message"
TOPIC_DEVICE_STATUS = f"{TOPIC_PREFIX}/device/{{}}/status"
TOPIC_MESSAGE_BROADCAST = f"{TOPIC_PREFIX}/messages/broadcast"

class MQTTPublisher:
    # ... (保持原有程式碼)
    
    def publish_message(self, from_device, to_target, text, priority=3):
        """發送訊息（新增功能，配合 server.cjs 的訊息系統）"""
        payload = {
            "id": f"msg-{int(time.time() * 1000)}",
            "from": from_device,
            "to": to_target,
            "text": text,
            "priority": priority,
            "timestamp": datetime.now(timezone.utc).isoformat()
        }
        
        # 決定 topic
        topic = TOPIC_MESSAGE_BROADCAST
        if to_target.startswith('group:'):
            group_name = to_target.replace('group:', '')
            topic = f"{TOPIC_PREFIX}/messages/group/{group_name}"
        elif to_target.startswith('device:'):
            device_id = to_target.replace('device:', '')
            topic = f"{TOPIC_PREFIX}/messages/device/{device_id}"
        
        result = self.client.publish(topic, json.dumps(payload), qos=1)
        print(f"💬 Message published: {from_device} → {to_target}")
        return result.is_published()
    
    def __init__(self):
        # 使用新版 paho-mqtt 的 Callback API
        self.client = mqtt.Client(callback_api_version=mqtt.CallbackAPIVersion.VERSION2)
        
    def connect(self):
        """建立與 MQTT Broker 的連線"""
        try:
            print(f"🔄 Connecting to MQTT Broker: {MQTT_BROKER}...")
            self.client.connect(MQTT_BROKER, MQTT_PORT, MQTT_KEEPALIVE)
            # 啟動背景迴圈處理網路封包
            self.client.loop_start()
            return True
        except Exception as e:
            print(f"❌ Connection failed: {e}")
            return False

    def disconnect(self):
        """關閉連線"""
        self.client.loop_stop()
        self.client.disconnect()
        
    def publish_gps_update(self, lat, lon, alt=0, device_id="camera_1", 
                          callsign=None, device_type="camera", group="未分組"):
        """發布 GPS 位置更新（增強版，支援更多參數）"""
        payload = {
            "deviceId": device_id,
            "latitude": lat,
            "longitude": lon,
            "altitude": alt,
            "accuracy": 10.0,
            "type": device_type,  # 新增
            "callsign": callsign or device_id,  # 新增
            "group": group,  # 新增
            "timestamp": datetime.now(timezone.utc).isoformat()
        }
        
        result = self.client.publish(TOPIC_CAMERA_GPS, json.dumps(payload), qos=1)
        print(f"📍 GPS update published: {device_id} at {lat}, {lon}")
        return result.is_published()

def main():
    parser = argparse.ArgumentParser(description='MQTT Publisher for Mezzo TAK Integration')
    parser.add_argument('command', nargs='?', default='status',
                       help='Command: left, right, capture, status, gps, cot, simulate, message')
    parser.add_argument('--device-id', default='camera_1',
                       help='Device ID (default: camera_1)')
    parser.add_argument('--lat', type=float, default=25.033964,
                       help='Latitude (default: 25.033964 - 台北101)')
    parser.add_argument('--lon', type=float, default=121.564472,
                       help='Longitude (default: 121.564472 - 台北101)')
    parser.add_argument('--alt', type=float, default=0,
                       help='Altitude (default: 0)')
    parser.add_argument('--callsign', default=None,
                       help='Callsign for device')
    parser.add_argument('--group', default='未分組',
                       help='Group name (default: 未分組)')
    parser.add_argument('--type', default='camera',
                       help='Device type (default: camera)')
    parser.add_argument('--duration', type=int, default=60,
                       help='Simulation duration in seconds (default: 60)')
    parser.add_argument('--interval', type=int, default=5,
                       help='Simulation interval in seconds (default: 5)')
    
    # 訊息相關參數
    parser.add_argument('--to', default='all',
                       help='Message recipient: all, group:NAME, device:ID')
    parser.add_argument('--text', default='Test message',
                       help='Message text')
    parser.add_argument('--priority', type=int, default=3,
                       help='Message priority (1-5, default: 3)')
    
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
                args.lat, args.lon, args.alt, 
                device_id=args.device_id,
                callsign=args.callsign,
                device_type=args.type,
                group=args.group
            )
            
        elif args.command == 'cot':
            publisher.publish_cot_message(
                uid=args.device_id,
                lat=args.lat,
                lon=args.lon,
                alt=args.alt,
                callsign=args.callsign or args.device_id
            )
        
        # 新增：訊息功能
        elif args.command == 'message':
            publisher.publish_message(
                from_device=args.device_id,
                to_target=args.to,
                text=args.text,
                priority=args.priority
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
            print("Available commands: left, right, capture, status, gps, cot, message, simulate")
        
        time.sleep(1)
        
    except KeyboardInterrupt:
        print("\n⚠️ Interrupted by user")
    except Exception as e:
        print(f"❌ Error: {e}")
    finally:
        publisher.disconnect()
        print("👋 Disconnected")

if __name__ == "__main__":
    main()