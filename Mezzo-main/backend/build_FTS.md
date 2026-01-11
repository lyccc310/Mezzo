# FreeTAKServer (FTS) 建置

本文件說明如何使用 **Docker** 建置 FreeTAKServer（FTS）

官方文件參考  
https://freetakteam.github.io/FreeTAKServer-User-Docs/Installation/mechanism/Docker/Quick_Start/

---

## 系統需求
- Docker ≥ 20.x  
---

## 架構與 Port 說明

FTS 至少需要以下關鍵 Port：

| Port  | 功能        | 說明 |
|------|------------|------|
| 8087 | TCP CoT    | WinTAK、Node.js 主要資料通道（最重要） |
| 19023| REST API   | Python SDK、API 操作與登入 |
| 8080 | Legacy API | 相容舊介面 |
| 8443 | SSL        | HTTPS / TLS |

---

## Docker Compose 設定

在backend資料夾中找到 `compose.yaml`，使用編輯器打開檔案，將 `FTS_IP` 改成自己的 ip 位置 (使用 ipconfig 找)
更改完後執行啟動指令:
```bash
docker compose up -d
```
當 FTS 怪怪的時候，重啟指令:
```bash
docker compose restart
```
---
## 測試FTS是否建立成功
- Step1: 打開 Wintak 並註冊連線
    - Host Address: 自己的 ip
    - Port: 8087
- Step2: 進入backend資料夾中找到 `debug.cjs`，記得將`HOST`改成自己的ip位置，改完後在backend資料夾下執行:
    ```bash
    node debug.cjs
    ```
- Step3: 看 Wintak 是否成功出現標記點
---
## 註冊裝置測試
(默認 Wintak 已打開且成功連線)
- Step1: 進入backend資料夾中找到 `server.cjs`，記得將`SERVER_URL`改成自己的ip位置，改完後在backend資料夾下執行:
    ```bash
    node server.cjs
    ```
- Step2: 去前端註冊裝置看是否成功