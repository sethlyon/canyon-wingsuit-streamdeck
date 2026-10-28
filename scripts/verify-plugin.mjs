import { WebSocketServer } from "ws";
import { spawn } from "node:child_process";

const wss = new WebSocketServer({ port: 0 }, () => {
  const port = wss.address().port;
  const info = JSON.stringify({
    application: { font: "Arial", language: "en", platform: "mac", platformVersion: "14.0", version: "6.6.0" },
    plugin: { uuid: "com.slyon.canyon-wingsuit", version: "1.0.3.0" },
    devicePixelRatio: 2,
    colors: {
      buttonPressedBackgroundColor: "#000000",
      buttonPressedBorderColor: "#000000",
      buttonPressedTextColor: "#ffffff",
      disabledColor: "#000000",
      highlightColor: "#000000",
      mouseDownColor: "#000000"
    },
    devices: [{ id: "dev1", name: "Stream Deck +", size: { columns: 4, rows: 2 }, type: 7 }]
  });

  const child = spawn(
    process.execPath,
    ["bin/plugin.js", "-port", String(port), "-pluginUUID", "uuid-123", "-registerEvent", "registerPlugin", "-info", info],
    {
      cwd: "./com.slyon.canyon-wingsuit.sdPlugin",
      stdio: "inherit"
    }
  );

  const received = new Set();
  wss.on("connection", (ws) => {
    ws.on("message", (data) => {
      const msg = JSON.parse(data.toString());
      received.add(msg.event);
      console.log("RECEIVED FROM PLUGIN:", msg.event);
      if (msg.event === "registerPlugin") {
        ws.send(
          JSON.stringify({
            event: "willAppear",
            action: "com.slyon.canyon-wingsuit.viewport",
            context: "key-0-0",
            device: "dev1",
            payload: { controller: "Keypad", coordinates: { column: 0, row: 0 }, isInMultiAction: false, settings: {} }
          })
        );
        ws.send(
          JSON.stringify({
            event: "willAppear",
            action: "com.slyon.canyon-wingsuit.dial",
            context: "dial-0",
            device: "dev1",
            payload: { controller: "Encoder", coordinates: { column: 0, row: 0 }, settings: {} }
          })
        );
      }
      if (received.has("setImage") && received.has("setFeedback")) {
        console.log("VERIFIED: Plugin connected and sent both setImage and setFeedback!");
        child.kill();
        wss.close();
        process.exit(0);
      }
    });
  });

  setTimeout(() => {
    console.error("TIMEOUT waiting for events. Received:", [...received]);
    child.kill();
    process.exit(1);
  }, 4000);
});
