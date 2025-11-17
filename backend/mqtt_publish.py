import sys
import paho.mqtt.publish as publish

command = sys.argv[1]  # 例如 'left', 'right', 'capture'

topic = "camera/control"
payload_map = {
    "left": '{"action": "left"}',
    "right": '{"action": "right"}',
    "capture": '{"action": "capture"}'
}

payload = payload_map.get(command, '{"action": "unknown"}')
publish.single(topic, payload, hostname="118.163.141.80", port=1883)
print(f"Published: {payload}")