# Robot Panel UI

TDK 機器人控制面板，以 HTML、CSS、JavaScript 搭配內附的 ROSLIB.js 實作，**不需要 npm 或編譯**，開啟即可使用。

## 功能

- **狀態監控**：快速查看機器人各部分狀態，包含 odom、vision、mission、nav2、localization（front / rear lidar）、電池等。
- **比賽快速啟動**：透過面板直接啟動對應場地的主程式（normal / mirror）。在 1 分鐘準備時間開始前就能全部設定完成，比賽開始後按下 `start_robot_fsm` 即可馬上開跑，也支援 reset。
- **遠端測試**：測試時可用筆電遠端監控，並啟動 / 停止主程式。

### 筆電遠端連線畫面
![image](https://hackmd.io/_uploads/HyLIw4G3Ml.png)

### 比賽現場
![image](https://hackmd.io/_uploads/rkSI8EM3Gl.png)

### 指示燈說明
![image](https://hackmd.io/_uploads/ByVqFNf2Mx.png)

## 本機使用

![image](https://hackmd.io/_uploads/Hyf4YEf2Gl.png)

1. 啟動機器人的定位與導航（`Loc_Normal`、`Loc_Mirror` 或 `Loc_DIT`），並確認 `rosbridge` 與 `robot_panel_bridge` 的 `fsm_launcher` 已啟動。

![image](https://hackmd.io/_uploads/SypiFVf3ze.png)

2. 開啟 robot_panel，確認各部分狀態正常。
3. 選擇與已載入地圖一致的模式：`START NORMAL`、`START MIRROR`、`START MIRROR V2` 或 `START DIT`。
4. 其他操作：
   - **STOP**：停止 FSM 並取消導航。
   - **RESET TO STAGE 2 / 3**：保留定位、截止時間及路線選擇，從指定關卡重新執行。

> 實際行為由配套後端決定。

## 區網使用

在機器人電腦的此目錄執行：

```bash
python3 -m http.server 8000 --bind 0.0.0.0
```

接著在另一台電腦開啟 `http://<機器人IP>:8000`，面板會使用網址中的主機位址連線至 rosbridge。

> 請確認 **8000**、**9090** port 可互通。

### 連線設定

連線參數位於 `app.js` 的 `CONFIG`：

| 服務 | Port |
| --- | --- |
| rosbridge | 9090 |
| Foxglove WebSocket | 8767 |
| Lichtblick | 8080 |

目前使用 `ws://`；若部署至 HTTPS 網站，需另行設定 WSS 與機器人連線。

## 狀態與倒數

各部分狀態依據 ROS topics、節點與訊息新鮮度判斷。

| 項目 | 來源 |
| --- | --- |
| 電量 | `/host/battery` |
| 比賽倒數 | `/fsm/match_remaining`（由後端管理） |
