# Robot Panel UI

TDK 機器人控制面板，使用 HTML、CSS、JavaScript 與內附的 ROSLIB.js，無需 npm 或編譯。

## 本機使用

1. 啟動機器人的定位與導航（Loc_Normal、Loc_Mirror 或 Loc_DIT），確認 rosbridge 與 robot_panel_bridge 的 fsm_launcher 已啟動。
2. 在機器人電腦用瀏覽器開啟 `index.html`，面板連線至 `ws://localhost:9090`。
3. 選擇與已載入地圖一致的 START NORMAL、START MIRROR、START MIRROR V2 或 START DIT。
4. STOP 停止 FSM 並取消導航；RESET TO STAGE 2 / 3 保留定位、截止時間及路線選擇，從指定關卡重新執行。實際行為由配套後端決定。

面板需要 robot_fsm_v2_ws 的 ROS 介面與後端，不會自行啟動 ROS 節點。

## 區網使用

在機器人電腦的此目錄執行：

```bash
python3 -m http.server 8000 --bind 0.0.0.0
```

另一台電腦開啟 `http://機器人IP:8000`；面板使用網址中的主機連線至 rosbridge。請確認 8000、9090 port 可互通。

`app.js` 的 `CONFIG` 設定連線：rosbridge 使用 9090、Foxglove WebSocket 使用 8767、Lichtblick 使用 8080。
目前使用 `ws://`；部署至 HTTPS 網站需要另行設定 WSS 與機器人連線。

## 狀態與倒數

狀態來自 ROS topics、節點與訊息新鮮度；電量來自 `/host/battery`，比賽倒數來自 `/fsm/match_remaining`，由後端管理。

## 更新 GitHub

```bash
git add README.md index.html app.js style.css assets vendor .gitignore
git commit -m "Update robot control panel"
git push
```
