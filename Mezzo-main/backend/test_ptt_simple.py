#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
PTT MQTT 通訊測試腳本
測試發送和接收 PTT 格式訊息
"""

import paho.mqtt.client as mqtt
import time
import struct

# ==================== 設定 ====================
BROKER = "118.163.141.80"
PORT = 1883
CLIENT_ID = f"test-client-{int(time.time())}"

# PTT 頻道
CHANNEL = "channel1"
DEVICE_ID = "TEST-PYTHON-001"

# ==================== PTT 訊息格式 ====================

def create_ptt_message(tag: str, uuid: str, data: str) -> bytes:
    """
    建立 PTT 格式訊息

    格式：
    - Tag: 32 bytes
    - UUID: 128 bytes
    - Data: 變長
    """
    # Tag (32 bytes)
    tag_bytes = tag.encode('utf-8')[:32].ljust(32, b'\x00')

    # UUID (128 bytes)
    uuid_bytes = uuid.encode('utf-8')[:128].ljust(128, b'\x00')

    # Data (變長)
    data_bytes = data.encode('utf-8')

    # 組合
    return tag_bytes + uuid_bytes + data_bytes


def parse_ptt_message(payload: bytes) -> dict:
    """
    解析 PTT 格式訊息
    """
    if len(payload) < 160:
        return None

    # 解析 Tag (前 32 bytes)
    tag = payload[0:32].decode('utf-8').rstrip('\x00')

    # 解析 UUID (接下來 128 bytes)
    uuid = payload[32:160].decode('utf-8').rstrip('\x00')

    # 解析 Data (剩餘部分)
    data = payload[160:].decode('utf-8')

    return {
        'tag': tag,
        'uuid': uuid,
        'data': data
    }


# ==================== MQTT 回調函數 ====================

def on_connect(client, userdata, flags, rc):
    """連接成功回調"""
    if rc == 0:
        print(f"✅ 已連接到 MQTT Broker: {BROKER}:{PORT}")

        # 訂閱所有 PTT 主題
        topic = f"/WJI/PTT/#"
        client.subscribe(topic)
        print(f"📡 已訂閱主題: {topic}")
    else:
        print(f"❌ 連接失敗，錯誤碼: {rc}")


def on_message(client, userdata, msg):
    """收到訊息回調"""
    topic = msg.topic
    payload = msg.payload

    print(f"\n📨 收到訊息:")
    print(f"   Topic: {topic}")
    print(f"   Size: {len(payload)} bytes")

    # 解析 PTT 訊息
    parsed = parse_ptt_message(payload)
    if parsed:
        print(f"   Tag: {parsed['tag']}")
        print(f"   UUID: {parsed['uuid']}")
        print(f"   Data: {parsed['data']}")
    else:
        print(f"   Raw: {payload[:100]}...")


def on_disconnect(client, userdata, rc):
    """斷線回調"""
    print(f"\n🔌 已斷線 (rc={rc})")


# ==================== 主要功能 ====================

def send_text_message(client, channel: str, text: str):
    """發送文字訊息"""
    topic = f"/WJI/PTT/{channel}/CHANNEL_ANNOUNCE"
    message = create_ptt_message("TEXT_MESSAGE", DEVICE_ID, text)

    result = client.publish(topic, message)

    if result.rc == mqtt.MQTT_ERR_SUCCESS:
        print(f"\n💬 已發送文字訊息:")
        print(f"   Topic: {topic}")
        print(f"   Text: {text}")
    else:
        print(f"❌ 發送失敗: {result.rc}")


def send_gps(client, channel: str, lat: float, lon: float):
    """發送 GPS 位置"""
    topic = f"/WJI/PTT/{channel}/GPS"
    data = f"{DEVICE_ID},{lat},{lon}"
    message = create_ptt_message("GPS", DEVICE_ID, data)

    result = client.publish(topic, message)

    if result.rc == mqtt.MQTT_ERR_SUCCESS:
        print(f"\n📍 已發送 GPS:")
        print(f"   Topic: {topic}")
        print(f"   Position: {lat}, {lon}")
    else:
        print(f"❌ 發送失敗: {result.rc}")


def send_sos(client, channel: str, lat: float, lon: float):
    """發送 SOS 求救"""
    topic = f"/WJI/PTT/{channel}/SOS"
    data = f"{lat},{lon}"
    message = create_ptt_message("SOS", DEVICE_ID, data)

    result = client.publish(topic, message)

    if result.rc == mqtt.MQTT_ERR_SUCCESS:
        print(f"\n🆘 已發送 SOS:")
        print(f"   Topic: {topic}")
        print(f"   Position: {lat}, {lon}")
    else:
        print(f"❌ 發送失敗: {result.rc}")


def send_broadcast(client, channel: str, text: str):
    """發送廣播訊息"""
    topic = f"/WJI/PTT/{channel}/CHANNEL_ANNOUNCE"
    message = create_ptt_message("BROADCAST", DEVICE_ID, text)

    result = client.publish(topic, message)

    if result.rc == mqtt.MQTT_ERR_SUCCESS:
        print(f"\n📢 已發送廣播:")
        print(f"   Topic: {topic}")
        print(f"   Text: {text}")
    else:
        print(f"❌ 發送失敗: {result.rc}")


# ==================== 互動式介面 ====================

def show_menu():
    """顯示選單"""
    print("\n" + "="*50)
    print("📡 PTT MQTT 測試工具")
    print("="*50)
    print("1. 發送文字訊息 (TEXT_MESSAGE)")
    print("2. 發送 GPS 位置")
    print("3. 發送 SOS 求救")
    print("4. 發送廣播訊息 (BROADCAST)")
    print("5. 更改頻道")
    print("6. 更改設備 ID")
    print("0. 退出")
    print("="*50)


def main():
    """主程式"""
    global CHANNEL, DEVICE_ID

    print("🚀 PTT MQTT 通訊測試腳本")
    print(f"📡 Broker: {BROKER}:{PORT}")
    print(f"📻 頻道: {CHANNEL}")
    print(f"📱 設備 ID: {DEVICE_ID}")

    # 建立 MQTT 客戶端
    client = mqtt.Client(CLIENT_ID)
    client.on_connect = on_connect
    client.on_message = on_message
    client.on_disconnect = on_disconnect

    # 連接到 Broker
    try:
        client.connect(BROKER, PORT, 60)
        client.loop_start()
        time.sleep(1)
    except Exception as e:
        print(f"❌ 連接失敗: {e}")
        return

    # 互動式選單
    while True:
        show_menu()
        choice = input("\n請選擇功能: ").strip()

        if choice == '1':
            text = input("輸入訊息內容: ").strip()
            if text:
                send_text_message(client, CHANNEL, text)

        elif choice == '2':
            lat = input("輸入緯度 (預設: 25.033964): ").strip() or "25.033964"
            lon = input("輸入經度 (預設: 121.564472): ").strip() or "121.564472"
            send_gps(client, CHANNEL, float(lat), float(lon))

        elif choice == '3':
            lat = input("輸入 SOS 緯度 (預設: 25.033964): ").strip() or "25.033964"
            lon = input("輸入 SOS 經度 (預設: 121.564472): ").strip() or "121.564472"
            send_sos(client, CHANNEL, float(lat), float(lon))

        elif choice == '4':
            text = input("輸入廣播內容: ").strip()
            if text:
                send_broadcast(client, CHANNEL, text)

        elif choice == '5':
            new_channel = input(f"輸入新頻道 (當前: {CHANNEL}): ").strip()
            if new_channel:
                CHANNEL = new_channel
                print(f"✅ 已切換到頻道: {CHANNEL}")

        elif choice == '6':
            new_id = input(f"輸入新設備 ID (當前: {DEVICE_ID}): ").strip()
            if new_id:
                DEVICE_ID = new_id
                print(f"✅ 已更改設備 ID: {DEVICE_ID}")

        elif choice == '0':
            print("\n👋 再見!")
            break

        else:
            print("❌ 無效選項，請重新選擇")

    # 清理
    client.loop_stop()
    client.disconnect()


if __name__ == "__main__":
    main()
