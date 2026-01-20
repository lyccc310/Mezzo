#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
PTT MQTT 自動化測試腳本
自動發送測試訊息並驗證系統功能
"""

import paho.mqtt.client as mqtt
import time
import sys

# ==================== 設定 ====================
BROKER = "118.163.141.80"
PORT = 1883
CLIENT_ID = f"auto-test-{int(time.time())}"

TEST_CHANNEL = "test"
TEST_DEVICE_ID = "AUTO-TEST-001"

# 測試結果
test_results = []


# ==================== PTT 訊息格式 ====================

def create_ptt_message(tag: str, uuid: str, data: str) -> bytes:
    tag_bytes = tag.encode('utf-8')[:32].ljust(32, b'\x00')
    uuid_bytes = uuid.encode('utf-8')[:128].ljust(128, b'\x00')
    data_bytes = data.encode('utf-8')
    return tag_bytes + uuid_bytes + data_bytes


# ==================== 測試案例 ====================

def test_text_message(client):
    """測試 1: 文字訊息"""
    print("\n📝 [測試 1] 發送文字訊息...")

    topic = f"/WJI/PTT/{TEST_CHANNEL}/CHANNEL_ANNOUNCE"
    text = f"自動化測試訊息 - {time.strftime('%H:%M:%S')}"
    message = create_ptt_message("TEXT_MESSAGE", TEST_DEVICE_ID, text)

    result = client.publish(topic, message)
    success = result.rc == mqtt.MQTT_ERR_SUCCESS

    test_results.append({
        'name': '文字訊息',
        'success': success,
        'details': f"Topic: {topic}, Text: {text}"
    })

    if success:
        print(f"   ✅ 成功發送")
    else:
        print(f"   ❌ 發送失敗 (rc={result.rc})")

    time.sleep(1)


def test_gps_location(client):
    """測試 2: GPS 定位"""
    print("\n📍 [測試 2] 發送 GPS 定位...")

    topic = f"/WJI/PTT/{TEST_CHANNEL}/GPS"
    lat, lon = 25.033964, 121.564472
    data = f"{TEST_DEVICE_ID},{lat},{lon}"
    message = create_ptt_message("GPS", TEST_DEVICE_ID, data)

    result = client.publish(topic, message)
    success = result.rc == mqtt.MQTT_ERR_SUCCESS

    test_results.append({
        'name': 'GPS 定位',
        'success': success,
        'details': f"Position: ({lat}, {lon})"
    })

    if success:
        print(f"   ✅ 成功發送")
    else:
        print(f"   ❌ 發送失敗 (rc={result.rc})")

    time.sleep(1)


def test_sos_alert(client):
    """測試 3: SOS 求救"""
    print("\n🆘 [測試 3] 發送 SOS 求救...")

    topic = f"/WJI/PTT/{TEST_CHANNEL}/SOS"
    lat, lon = 25.040000, 121.570000
    data = f"{lat},{lon}"
    message = create_ptt_message("SOS", TEST_DEVICE_ID, data)

    result = client.publish(topic, message)
    success = result.rc == mqtt.MQTT_ERR_SUCCESS

    test_results.append({
        'name': 'SOS 求救',
        'success': success,
        'details': f"SOS Position: ({lat}, {lon})"
    })

    if success:
        print(f"   ✅ 成功發送")
    else:
        print(f"   ❌ 發送失敗 (rc={result.rc})")

    time.sleep(1)


def test_broadcast(client):
    """測試 4: 廣播訊息"""
    print("\n📢 [測試 4] 發送廣播訊息...")

    topic = f"/WJI/PTT/{TEST_CHANNEL}/CHANNEL_ANNOUNCE"
    text = f"系統廣播測試 - {time.strftime('%Y-%m-%d %H:%M:%S')}"
    message = create_ptt_message("BROADCAST", TEST_DEVICE_ID, text)

    result = client.publish(topic, message)
    success = result.rc == mqtt.MQTT_ERR_SUCCESS

    test_results.append({
        'name': '廣播訊息',
        'success': success,
        'details': f"Broadcast: {text}"
    })

    if success:
        print(f"   ✅ 成功發送")
    else:
        print(f"   ❌ 發送失敗 (rc={result.rc})")

    time.sleep(1)


def test_mark_recording(client):
    """測試 5: 錄影標記"""
    print("\n📹 [測試 5] 發送錄影標記...")

    # 開始錄影
    topic = f"/WJI/PTT/{TEST_CHANNEL}/MARK"
    message_start = create_ptt_message("MARK_START", TEST_DEVICE_ID, "")
    result1 = client.publish(topic, message_start)

    time.sleep(0.5)

    # 停止錄影
    message_stop = create_ptt_message("MARK_STOP", TEST_DEVICE_ID, "")
    result2 = client.publish(topic, message_stop)

    success = (result1.rc == mqtt.MQTT_ERR_SUCCESS and
               result2.rc == mqtt.MQTT_ERR_SUCCESS)

    test_results.append({
        'name': '錄影標記',
        'success': success,
        'details': "MARK_START + MARK_STOP"
    })

    if success:
        print(f"   ✅ 成功發送 (開始 + 停止)")
    else:
        print(f"   ❌ 發送失敗")

    time.sleep(1)


def test_multiple_channels(client):
    """測試 6: 多頻道測試"""
    print("\n📻 [測試 6] 測試多個頻道...")

    channels = ["channel1", "channel2", "emergency"]
    success_count = 0

    for channel in channels:
        topic = f"/WJI/PTT/{channel}/CHANNEL_ANNOUNCE"
        text = f"頻道測試 - {channel}"
        message = create_ptt_message("TEXT_MESSAGE", TEST_DEVICE_ID, text)

        result = client.publish(topic, message)
        if result.rc == mqtt.MQTT_ERR_SUCCESS:
            success_count += 1
            print(f"   ✅ {channel} 成功")
        else:
            print(f"   ❌ {channel} 失敗")

        time.sleep(0.5)

    success = success_count == len(channels)

    test_results.append({
        'name': '多頻道測試',
        'success': success,
        'details': f"{success_count}/{len(channels)} 成功"
    })

    time.sleep(1)


def test_stress_messages(client):
    """測試 7: 壓力測試 (連續發送)"""
    print("\n⚡ [測試 7] 壓力測試 (10 則訊息)...")

    topic = f"/WJI/PTT/{TEST_CHANNEL}/CHANNEL_ANNOUNCE"
    success_count = 0

    for i in range(10):
        text = f"壓力測試訊息 #{i+1}"
        message = create_ptt_message("TEXT_MESSAGE", TEST_DEVICE_ID, text)
        result = client.publish(topic, message)

        if result.rc == mqtt.MQTT_ERR_SUCCESS:
            success_count += 1

        time.sleep(0.1)  # 100ms 間隔

    success = success_count == 10

    test_results.append({
        'name': '壓力測試',
        'success': success,
        'details': f"{success_count}/10 成功"
    })

    if success:
        print(f"   ✅ 全部成功 ({success_count}/10)")
    else:
        print(f"   ⚠️ 部分成功 ({success_count}/10)")


# ==================== MQTT 回調 ====================

def on_connect(client, userdata, flags, rc):
    if rc == 0:
        print(f"✅ 已連接到 MQTT Broker")
    else:
        print(f"❌ 連接失敗 (rc={rc})")
        sys.exit(1)


def on_disconnect(client, userdata, rc):
    print(f"🔌 已斷線")


# ==================== 主程式 ====================

def print_summary():
    """顯示測試摘要"""
    print("\n" + "="*60)
    print("📊 測試結果摘要")
    print("="*60)

    passed = sum(1 for t in test_results if t['success'])
    total = len(test_results)

    for i, test in enumerate(test_results, 1):
        status = "✅ PASS" if test['success'] else "❌ FAIL"
        print(f"{i}. {test['name']:20} {status}")
        print(f"   {test['details']}")

    print("="*60)
    print(f"總計: {passed}/{total} 通過")

    if passed == total:
        print("🎉 所有測試通過！")
    else:
        print(f"⚠️ {total - passed} 項測試失敗")

    print("="*60)


def main():
    """主程式"""
    print("\n🚀 PTT MQTT 自動化測試")
    print(f"📡 Broker: {BROKER}:{PORT}")
    print(f"📻 測試頻道: {TEST_CHANNEL}")
    print(f"📱 測試設備: {TEST_DEVICE_ID}")
    print("\n開始測試...\n")

    # 建立 MQTT 客戶端
    client = mqtt.Client(CLIENT_ID)
    client.on_connect = on_connect
    client.on_disconnect = on_disconnect

    # 連接到 Broker
    try:
        client.connect(BROKER, PORT, 60)
        client.loop_start()
        time.sleep(2)
    except Exception as e:
        print(f"❌ 連接失敗: {e}")
        return

    # 執行測試
    try:
        test_text_message(client)
        test_gps_location(client)
        test_sos_alert(client)
        test_broadcast(client)
        test_mark_recording(client)
        test_multiple_channels(client)
        test_stress_messages(client)
    except KeyboardInterrupt:
        print("\n⚠️ 測試中斷")
    except Exception as e:
        print(f"\n❌ 測試錯誤: {e}")
    finally:
        # 清理
        time.sleep(2)
        client.loop_stop()
        client.disconnect()

        # 顯示摘要
        print_summary()


if __name__ == "__main__":
    main()
