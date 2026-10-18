// =====================================================================
// CONFIG
// =====================================================================
function resolveHostname() {
  // Opened via file:// (e.g. straight from the desktop icon) has no
  // hostname at all -- fall back to localhost. Opened over http(s) from
  // another machine on the LAN, reuse whatever host the page itself was
  // loaded from so this isn't hardcoded to one machine.
  const h = window.location.hostname;
  return h && window.location.protocol !== 'file:' ? h : 'localhost';
}

const CONFIG = {
  hostname: resolveHostname(),
  rosbridgePort: 9090,
  foxglovePort: 8767,
  lichtblickPort: 8080,
  robotModelImage: "assets/robot-model.png",

  // mode: "existence"      -> topic must be advertised (has a publisher), no message check
  //       "node_existence" -> a specific node name must be present in the ROS graph
  //       "message_liveness" -> messages must actually arrive within livenessTimeoutMs
  //       "derived"          -> computed in computeDerivedStates() from other keys below,
  //                             not polled directly -- no matching dot required in the HTML
  //       "not_implemented"  -> feature not wired yet, always shown disabled/gray
  topics: {
    // micro-ROS agent doesn't tear down the /odom publisher entity the
    // moment the serial link to the STM32 actually drops (e.g. unplugging
    // the ST-Link) -- it just stops producing new messages. So "does /odom
    // exist" stays true long after a real disconnect; only checking that
    // messages are still actually arriving catches it.
    chassis:      { name: "/odom", type: "nav_msgs/Odometry", mode: "message_liveness" },
    // MISSION is derived from two signals (see computeDerivedStates):
    //   - mechanism_command: /mechanism/command is only published on-demand
    //     while the FSM is actively issuing a command, not continuously --
    //     a liveness/timeout check would flicker red during perfectly
    //     normal idle gaps, so plain existence is the right check here.
    //   - straw_pick_status: /mechanism/straw_pick_status is the STM's
    //     stage-3 pick feedback, streamed continuously at 10-20Hz whenever
    //     the mechanism side is actually alive and talking back, so
    //     message_liveness is the right (and available) check here.
    mission:            { mode: "derived" },
    mechanism_command:  { name: "/mechanism/command", mode: "existence" },
    straw_pick_status:  { name: "/mechanism/straw_pick_status", type: "robot_interfaces/msg/StrawPickStatus", mode: "message_liveness" },
    // /straw/target is published continuously by straw_node (TDK-straw,
    // launched via the "vision" desktop icon) whenever the pipeline is up,
    // valid:true/false and all -- same continuously-streaming shape as
    // /odom, so message_liveness (not existence) is the right check here too.
    vision:       { name: "/straw/target", type: "straw_interfaces/msg/StrawTarget", mode: "message_liveness" },
    navigation:   { nodeName: "/bt_navigator", mode: "node_existence" },
    // No cartographer topic exposes a real "well localized" signal (checked:
    // /constraint_list is a bare visualization_msgs/MarkerArray with no
    // node/submap/score fields). This just proves the SLAM+TF pipeline is
    // alive, not that the pose is accurate.
    localization: { name: "/robot_pose", type: "geometry_msgs/PoseStamped", mode: "message_liveness" },

    odometry:     { name: "/odom", type: "nav_msgs/Odometry", mode: "message_liveness" },
    front_lidar:  { name: "/front/scan", type: "sensor_msgs/LaserScan", mode: "message_liveness" },
    rear_lidar:   { name: "/rear/scan", type: "sensor_msgs/LaserScan", mode: "message_liveness" },
    // Same underlying signal as "vision" above (/straw/target) -- this repo
    // already does that for chassis/odometry (both /odom), one shown under
    // SYSTEM STATUS and the other under DEVICE STATUS.
    camera:       { name: "/straw/target", type: "straw_interfaces/msg/StrawTarget", mode: "message_liveness" },

    fsm_running:  { nodeName: "/robot_fsm_main", mode: "node_existence" }
  },

  livenessTimeoutMs: 2000,
  pollIntervalMs: 1500,

  // robot_panel_bridge's fsm_launcher node (see workspaces/start.sh), one
  // service per competition field side. It refuses a side that doesn't match
  // the map loaded by the TDK Loc_Normal / TDK Loc_Mirror desktop icon.
  fsmStartServices: {
    normal: { name: "/fsm/start_normal", type: "std_srvs/Trigger" },
    mirror: { name: "/fsm/start_mirror", type: "std_srvs/Trigger" },
    mirror_v2: { name: "/fsm/start_mirror_v2", type: "std_srvs/Trigger" },
    dit: { name: "/fsm/start_dit", type: "std_srvs/Trigger" }
  },
  // Same fsm_launcher node: zero /cmd_vel, stop robot_fsm_main, cancel Nav2 goals.
  fsmStopService: { name: "/fsm/stop", type: "std_srvs/Trigger" },
  // Same fsm_launcher node: stop like fsmStopService, then relaunch robot_fsm_main
  // Both resets keep localization and the match deadline.
  fsmResetStage2Service: { name: "/fsm/reset_stage2", type: "std_srvs/Trigger" },
  fsmResetStage3Service: { name: "/fsm/reset_stage3", type: "std_srvs/Trigger" },

  // Host (laptop) battery, published by robot_panel_bridge's battery_monitor
  // (always-on container in microros_ws/docker/docker-compose.yaml) from
  // /sys/class/power_supply. Not navigator.getBattery(): the panel is also
  // opened from other LAN machines, which would show the viewer's battery.
  hostBattery: {
    name: "/host/battery",
    type: "sensor_msgs/BatteryState",
    warnBelow: 0.40,   // yellow below 40%
    lowBelow: 0.20,    // red below 20%
    staleMs: 5000      // published at 1Hz; no message for this long -> NO DATA
  },

  // Match countdown, published at 1Hz by robot_panel_bridge's fsm_launcher
  // once START NORMAL / MIRROR / DIT has set the deadline (RESET and STOP keep
  // it). Remaining seconds, ticked down locally between messages.
  matchTimer: {
    name: "/fsm/match_remaining",
    type: "std_msgs/Float64",
    warnBelow: 60,     // yellow below 1:00
    lowBelow: 30       // red below 0:30
  },

  // Set true to drive the UI from fake data instead of a real rosbridge
  // connection (useful for layout/style work without a robot attached).
  MOCK_MODE: false,
  mockIntervalMs: 1500
};

// =====================================================================
// STATE
// =====================================================================
const robotState = {
  chassis: null,
  mission: null,
  mechanism_command: null,
  straw_pick_status: null,
  vision: null,
  navigation: null,
  localization: null,

  odometry: null,
  front_lidar: null,
  rear_lidar: null,
  camera: null,

  communication_ready: false,
  localization_ready: false,
  fsm_running: null
};

function isNotImplemented(key) {
  const t = CONFIG.topics[key];
  return t && t.mode === "not_implemented";
}

function setStatus(key, value) {
  if (robotState[key] === value) return;
  robotState[key] = value;
  computeDerivedStates();
  render();
}

function computeDerivedStates() {
  robotState.mission = robotState.mechanism_command === true && robotState.straw_pick_status === true;
  robotState.communication_ready = robotState.odometry === true && robotState.mission === true;
  robotState.localization_ready = robotState.localization === true && robotState.navigation === true;
}

// =====================================================================
// RENDER
// =====================================================================
function paintDot(el, key) {
  if (!el) return;
  el.classList.remove("on", "off", "disabled");
  if (isNotImplemented(key) || robotState[key] === null) {
    el.classList.add("disabled");
  } else if (robotState[key] === true) {
    el.classList.add("on");
  } else {
    el.classList.add("off");
  }
}

function render() {
  document.querySelectorAll("[data-dot]").forEach(el => paintDot(el, el.dataset.dot));
  document.querySelectorAll(".state-item").forEach(el => {
    el.classList.toggle("ready", robotState[el.dataset.key] === true);
  });
}

// =====================================================================
// HOST BATTERY
// =====================================================================
// sensor_msgs/BatteryState.power_supply_status
const BATTERY_STATUS_TEXT = {
  0: "UNKNOWN",
  1: "CHARGING",
  2: "DISCHARGING",
  3: "NOT CHARGING",
  4: "FULL"
};
const BATTERY_CHARGING = 1;
const BATTERY_DISCHARGING = 2;

let hostBatteryStaleHandle = null;

// rosbridge maps NaN (BatteryState's "not measured") to null.
const isNum = (v) => typeof v === "number" && isFinite(v);

function formatDuration(hours) {
  const totalMin = Math.round(hours * 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `~${h}H ${String(m).padStart(2, "0")}M`;
}

function renderHostBattery(msg) {
  const root = document.getElementById("host-battery");
  const set = (id, text) => { document.getElementById(id).textContent = text; };

  if (!msg) {
    root.dataset.level = "unknown";
    document.getElementById("hb-fill").style.width = "0";
    set("hb-percent", "--%");
    set("hb-power", "-- W");
    set("hb-status", "NO DATA");
    set("hb-time-label", "REMAINING");
    set("hb-time", "--");
    return;
  }

  const cfg = CONFIG.hostBattery;
  const pct = isNum(msg.percentage) ? msg.percentage : null;
  root.dataset.level = pct === null ? "unknown"
    : pct < cfg.lowBelow ? "low"
    : pct < cfg.warnBelow ? "warn"
    : "ok";
  document.getElementById("hb-fill").style.width = pct === null ? "0" : `${Math.round(pct * 100)}%`;
  set("hb-percent", pct === null ? "--%" : `${Math.round(pct * 100)}%`);

  const current = isNum(msg.current) ? Math.abs(msg.current) : null;
  set("hb-power", isNum(msg.voltage) && current !== null
    ? `${(msg.voltage * current).toFixed(1)} W` : "-- W");

  const status = msg.power_supply_status;
  set("hb-status", BATTERY_STATUS_TEXT[status] || "UNKNOWN");

  // Discharging: time until empty. Charging: time until full. Needs a
  // non-trivial current, otherwise the estimate is meaningless.
  let hours = null;
  if (current !== null && current > 0.05 && isNum(msg.charge)) {
    if (status === BATTERY_DISCHARGING) {
      hours = msg.charge / current;
    } else if (status === BATTERY_CHARGING && isNum(msg.capacity)) {
      hours = Math.max(0, msg.capacity - msg.charge) / current;
    }
  }
  set("hb-time-label", status === BATTERY_CHARGING ? "TO FULL" : "REMAINING");
  set("hb-time", hours === null ? "--" : formatDuration(hours));
}

function subscribeHostBattery() {
  const cfg = CONFIG.hostBattery;
  const topic = new ROSLIB.Topic({ ros, name: cfg.name, messageType: cfg.type, throttle_rate: 500 });
  topic.subscribe((msg) => {
    renderHostBattery(msg);
    clearTimeout(hostBatteryStaleHandle);
    hostBatteryStaleHandle = setTimeout(() => renderHostBattery(null), cfg.staleMs);
  });
}

// =====================================================================
// MATCH TIMER
// =====================================================================
let matchDeadlineMs = null;  // local Date.now() at which the match ends
let matchTimerIntervalHandle = null;

function renderMatchTimer() {
  const el = document.getElementById("match-timer");
  if (matchDeadlineMs === null) {
    el.dataset.level = "unknown";
    el.textContent = "--:--";
    return;
  }
  const cfg = CONFIG.matchTimer;
  const sec = Math.max(0, Math.ceil((matchDeadlineMs - Date.now()) / 1000));
  el.dataset.level = sec < cfg.lowBelow ? "low" : sec < cfg.warnBelow ? "warn" : "ok";
  el.textContent = `${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}`;
}

function subscribeMatchTimer() {
  const cfg = CONFIG.matchTimer;
  const topic = new ROSLIB.Topic({ ros, name: cfg.name, messageType: cfg.type });
  topic.subscribe((msg) => {
    matchDeadlineMs = Date.now() + msg.data * 1000;
    renderMatchTimer();
  });
  clearInterval(matchTimerIntervalHandle);
  matchTimerIntervalHandle = setInterval(renderMatchTimer, 200);
}

// =====================================================================
// ROS INTEGRATION
// =====================================================================
let ros = null;
let pollIntervalHandle = null;
let livenessIntervalHandle = null;
let reconnectTimeoutHandle = null;
const lastMsgAt = {};

function markAllDisconnected() {
  Object.entries(CONFIG.topics).forEach(([key, cfg]) => {
    if (cfg.mode !== "not_implemented" && cfg.mode !== "derived") setStatus(key, false);
  });
}

function subscribeLivenessTopics() {
  Object.entries(CONFIG.topics).forEach(([key, cfg]) => {
    if (cfg.mode !== "message_liveness") return;
    lastMsgAt[key] = 0;
    const topic = new ROSLIB.Topic({ ros, name: cfg.name, messageType: cfg.type });
    topic.subscribe(() => {
      lastMsgAt[key] = Date.now();
      setStatus(key, true);
    });
  });

  livenessIntervalHandle = setInterval(() => {
    const now = Date.now();
    Object.entries(CONFIG.topics).forEach(([key, cfg]) => {
      if (cfg.mode !== "message_liveness") return;
      if (now - (lastMsgAt[key] || 0) > CONFIG.livenessTimeoutMs) {
        setStatus(key, false);
      }
    });
  }, 500);
}

function pollExistence() {
  if (!ros) return;

  ros.getTopics((res) => {
    const topicSet = new Set(res.topics);
    Object.entries(CONFIG.topics).forEach(([key, cfg]) => {
      if (cfg.mode === "existence") setStatus(key, topicSet.has(cfg.name));
    });
  });

  ros.getNodes((nodes) => {
    const nodeSet = new Set(nodes);
    Object.entries(CONFIG.topics).forEach(([key, cfg]) => {
      if (cfg.mode === "node_existence") setStatus(key, nodeSet.has(cfg.nodeName));
    });
  });
}

function connectROS() {
  const url = `ws://${CONFIG.hostname}:${CONFIG.rosbridgePort}`;
  console.log(`[robot_panel_ui] connecting to rosbridge at ${url} ...`);
  ros = new ROSLIB.Ros({ url });

  ros.on("connection", () => {
    console.log("[robot_panel_ui] rosbridge connected.");
    clearInterval(pollIntervalHandle);
    clearInterval(livenessIntervalHandle);
    pollExistence();
    pollIntervalHandle = setInterval(pollExistence, CONFIG.pollIntervalMs);
    subscribeLivenessTopics();
    subscribeHostBattery();
    subscribeMatchTimer();
  });

  ros.on("error", (err) => {
    console.error("[robot_panel_ui] rosbridge error:", err);
  });

  ros.on("close", () => {
    console.warn("[robot_panel_ui] rosbridge connection closed, retrying in 2s...");
    clearInterval(pollIntervalHandle);
    clearInterval(livenessIntervalHandle);
    markAllDisconnected();
    clearTimeout(hostBatteryStaleHandle);
    renderHostBattery(null);
    clearInterval(matchTimerIntervalHandle);
    matchDeadlineMs = null;
    renderMatchTimer();
    clearTimeout(reconnectTimeoutHandle);
    reconnectTimeoutHandle = setTimeout(connectROS, 2000);
  });
}

function onResetStage2(button) {
  callFsmService(button, CONFIG.fsmResetStage2Service);
}

function onResetStage3(button) {
  callFsmService(button, CONFIG.fsmResetStage3Service);
}

function onStartFsm(button) {
  callFsmService(button, CONFIG.fsmStartServices[button.dataset.startSide]);
}

function onStopFsm(button) {
  callFsmService(button, CONFIG.fsmStopService);
}

function callFsmService(button, cfg) {
  const status = button.querySelector("[data-start-status]");
  const show = (text, isError) => {
    status.textContent = text;
    status.classList.toggle("start-error", isError);
  };
  if (!ros) {
    show("NOT CONNECTED TO ROSBRIDGE", true);
    return;
  }
  show("...", false);
  const client = new ROSLIB.Service({ ros, name: cfg.name, serviceType: cfg.type });
  client.callService(new ROSLIB.ServiceRequest({}), (result) => {
    console.log(`[robot_panel_ui] ${cfg.name} ->`, result);
    show(result.message, !result.success);
  }, (error) => {
    console.error(`[robot_panel_ui] ${cfg.name} failed:`, error);
    show(`FAILED: ${error}`, true);
  });
}

// =====================================================================
// MOCK DATA (CONFIG.MOCK_MODE only)
// =====================================================================
function startMockMode() {
  setStatus("rear_lidar", false);
  setStatus("fsm_running", false);
  renderHostBattery({ percentage: 0.33, voltage: 10.82, current: -1.835, charge: 1.864, capacity: 5.63, power_supply_status: BATTERY_DISCHARGING });

  setInterval(() => {
    setStatus(k, Math.random() > 0.15);
  }, CONFIG.mockIntervalMs);
}

// =====================================================================
// WIRING
// =====================================================================
document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("robot-model-img").src = CONFIG.robotModelImage;

  document.getElementById("robot-panel-link").href =
    `http://${CONFIG.hostname}:${CONFIG.lichtblickPort}/?ds=foxglove-websocket&ds.url=ws://${CONFIG.hostname}:${CONFIG.foxglovePort}`;

  document.querySelectorAll(".mission-item[data-fsm-reset-stage2]").forEach(el => {
    el.addEventListener("click", () => onResetStage2(el));
  });
  document.querySelectorAll(".mission-item[data-fsm-reset]").forEach(el => {
    el.addEventListener("click", () => onResetStage3(el));
  });
  document.querySelectorAll(".mission-item[data-start-side]").forEach(el => {
    el.addEventListener("click", () => onStartFsm(el));
  });
  document.querySelectorAll(".mission-item[data-fsm-stop]").forEach(el => {
    el.addEventListener("click", () => onStopFsm(el));
  });

  render();

  if (CONFIG.MOCK_MODE) {
    startMockMode();
  } else {
    connectROS();
  }
});
