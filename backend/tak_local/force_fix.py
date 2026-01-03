import os

# 從錯誤訊息中提取的「絕對路徑」，可能要自己先執行看看 FTS 以找到此絕對路徑 (找: default_factory.py)
target_file = r".venv\Lib\site-packages\digitalpy\core\main\impl\default_factory.py"

print(f"[-] 目標檔案: {target_file}")

if not os.path.exists(target_file):
    print("[!] 錯誤：找不到檔案！請確認路徑是否正確。")
    exit(1)

# 讀取檔案
with open(target_file, "r", encoding="utf-8") as f:
    lines = f.readlines()

new_lines = []
fixed_count = 0

for i, line in enumerate(lines):
    # 找到那個導致崩潰的 setattr 語句
    if "setattr(instance, key, value)" in line and "try:" not in line:
        indent = line[:line.find("setattr")] # 保持原本的縮排

        # 把它包在 try-except 裡，如果報錯就忽略，不要讓伺服器當機
        new_lines.append(f"{indent}try:\n")
        new_lines.append(f"{indent}    setattr(instance, key, value)\n")
        new_lines.append(f"{indent}except AttributeError:\n")
        new_lines.append(f"{indent}    pass # (強制修復) 忽略唯讀屬性錯誤\n")

        fixed_count += 1
        print(f"[*] 已在第 {i+1} 行注入保護機制")
    else:
        new_lines.append(line)

if fixed_count > 0:
    with open(target_file, "w", encoding="utf-8") as f:
        f.writelines(new_lines)
    print(f"\n[OK] 成功修復！共修改了 {fixed_count} 處。")
    print("現在你可以重新啟動 FreeTAKServer 了。")
else:
    print("\n[?] 沒有找到需要修復的地方，可能已經修復過了。")