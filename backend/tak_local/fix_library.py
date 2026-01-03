import os
import site
import sys

# 1. 定義我們要修正的目標路徑 (你的 Windows 資料夾)
# 注意：這裡使用雙反斜線
TARGET_DIR = os.path.join(os.getcwd(), "FTS_Data").replace("\\", "\\\\")

# 2. 找到虛擬環境中的 site-packages (安裝套件的地方)
site_packages = site.getsitepackages()
fts_path = None

for path in site_packages:
    check_path = os.path.join(path, "FreeTAKServer")
    if os.path.exists(check_path):
        fts_path = check_path
        break

if not fts_path:
    print("[!] 找不到 FreeTAKServer 安裝位置，請確認你在虛擬環境 (.venv) 中。")
    sys.exit(1)

print(f"[-] 找到 FTS 安裝位置: {fts_path}")

# 3. 搜尋並取代所有檔案中的 "/opt/fts"
count = 0
for root, dirs, files in os.walk(fts_path):
    for file in files:
        if file.endswith(".py"):
            file_path = os.path.join(root, file)

            try:
                with open(file_path, "r", encoding="utf-8") as f:
                    content = f.read()

                # 關鍵：取代 Linux 路徑
                if "/opt/fts" in content:
                    print(f"[*] 正在修復檔案: {file}")
                    # 取代為你的 Windows 路徑
                    new_content = content.replace("/opt/fts", TARGET_DIR)

                    with open(file_path, "w", encoding="utf-8") as f:
                        f.write(new_content)
                    count += 1
            except Exception as e:
                print(f"[!] 無法讀取 {file}: {e}")

if count > 0:
    print(f"\n[OK] 成功修復了 {count} 個檔案！現在 FTS 應該可以在 Windows 上跑了。")
else:
    print("\n[?] 沒有找到需要修復的檔案，可能已經修復過，或是版本不同。")

# 4. 順便建立必要的資料夾
if not os.path.exists("FTS_Data"):
    os.makedirs("FTS_Data")
    print("[-] 已建立 FTS_Data 資料夾")