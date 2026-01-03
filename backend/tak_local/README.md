# FreeTAKServer on Windows 安裝與修復指南

本文件記錄了如何在 **Windows 環境** 成功架設原本設計給 **Linux** 的  
**FreeTAKServer (FTS)**，以及為了解決 Dependency Hell（相依性地獄）  
所進行的關鍵修復流程。

> 🎯 目標  
> 即使刪除 `.venv` 或重灌環境，只要照此 README 操作，即可完整還原可運作的 FreeTAKServer。

---

## 1. 安裝 FreeTAKServer

```bash
# 請確認使用 Python 3.11
pip install FreeTAKServer
```
## 2. 基礎環境設置
* 作業系統：Windows
* 開發環境：VS Code
* Python 版本：3.11（FTS 官方支援版本）
* 虛擬環境：.venv（必要）

>⚠️所有後續修改皆發生在 .venv 內，不會污染系統 Python。

## 3. 修正 Linux 路徑問題 (fix_library.py)
* 問題說明: FreeTAKServer 原始碼中 寫死了 Linux 路徑：/opt/fts ，導致 Windows 無法正確載入相關資源。
* 解決方案: 編寫 `fix_library.py` 腳本，自動替換路徑。

1. 在專案目錄下建立資料夾 FTS_Data，例: C:\Users\yunchen\work\pytak\FTS_Data
2. 撰寫並執行修復腳本 fix_library.py

```bash
python fix_library.py
```
* fix_library.py 功能說明: 遍歷 .venv/site-packages 中所有 FreeTAKServer 原始碼
  將所有 /opt/fts 替換為 Windows 下的 FTS_Data 絕對路徑
  直接修改安裝在虛擬環境內的套件原始碼

## 4. 修正依賴衝突導致的服務崩潰 (force_fix.py)
* 問題說明: digitalpy 套件試圖設定 span_exporter，但新版 opentelemetry 禁止動態修改該屬性
* 解決方案: 編寫 `force_fix.py` 腳本。
>⚠️ 注意: 參數 target_file 可能會需要修改，邏輯是找到 default_factory.py 並修改程式碼。

```bash
python force_fix.py
```
* force_fix.py 功能說明: 找到 default_factory.py ，將出錯的 setattr(...) 外層包上：
```python
try:
    ...
except Exception:
    pass
```
忽略該錯誤，避免整個 CoT Service 崩潰

* 若沒有成功執行、修改程式碼，可以直接在 terminal 輸入
```bash
.venv\Lib\site-packages\digitalpy\core\main\impl\default_factory.py
```
找到約在 140 行左右的
```python
setattr(instance, key, value)
```
改成
```python
try:
    setattr(instance, key, value)
except Exception:
    pass
```
## 5. 修正依賴衝突導致的服務崩潰 (force_fix.py)
修復完成後，不要使用 YAML 設定檔 （新版 FTS 在 Windows 下讀取 YAML 有問題）
```bash
python -m FreeTAKServer.controllers.services.FTS `
  -CoTPort 8087 `
  -RestAPIPort 19023 `
  -CoTIP 0.0.0.0 `
  -RestAPIIP 0.0.0.0 `
  -AutoStart true
```
## 6. Node.js 後端設定（TAK 連線）
在 server.cjs 中設定：
```javascript
const TAK_CONFIG = {
    enabled: true,       // 啟用 TAK
    host: '127.0.0.1',   // 本機
    port: 8087,          // 對應 CoTPort
    useTLS: false
};
```
## 7. 重建環境快速指南（災後復原用）
如果刪掉 .venv 、重裝 Python 、換電腦
只要照順序做：
```bash
pip install FreeTAKServer
python fix_library.py
python force_fix.py
```
然後用 第 5 節的啟動指令 啟動 Server。