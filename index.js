const express = require("express");
const bodyParser = require("body-parser");
const uuid = require("uuid");
const fs = require("fs");
const ws = require("ws");
const Executor = require("./executor");
const config = require("./config.json");
const Convert = require('ansi-to-html');
const converter = new Convert();

// Create app
const app = express();
app.use(bodyParser.json());
app.use(express.static(__dirname + "/public"));

// Main route
app.get("/", (req, res) => {
  return res.send(fs.readFileSync(__dirname + "/public/index.html"));
})

const executions = new Map();

// Route for starting an execution
app.post("/execute", (req, res) => {
  // Check valid body
  if (!req.body.hasOwnProperty("source")) {
    return res.status(400).send({
      message: "Expected source in body"
    });
  }

  // Create env
  const id = uuid.v4();
  const executor = new Executor(req.body.source, [
    "--file-access=n",
    "--max-iterations=100",
    "--os-apis=false",
    "--can-spawn-processes=false"
  ]);

  executions.set(id, {
    executor: executor,
    createdAt: Date.now()
  });

  return res.status(200).send({
    executionId: id,
  });
});

// WS stuff
const wsServer = new ws.Server({ noServer: true });
wsServer.on('connection', socket => {
  let executorId = null;
  let hasStarted = false;

  function error(text) {
    socket.send(JSON.stringify({
      type: "error",
      message: text,
    }));
    socket.close();
  }

  socket.on('message', data => {
    const msg = Buffer.from(data).toString();

    try {
      const json = JSON.parse(msg);

      // Check type
      switch (json.type) {
        case "auth":
          if (executorId != null) return;
          
          // Check ID
          if (executions.has(json.id) == false) {
            error(`Invalid ID ${json.id}`);
          }

          executorId = json.id;

          socket.send(JSON.stringify({
            type: "ready"
          }));
          break;
        case "start":
          if (executorId == null) {
            return error(`Provide ID with {"type":"auth","id":"your id"}`);
          } else if (hasStarted) {
            return error(`This execution has already started`);
          }

          // Register events
          /**
           * @type {Executor}
           */
          const executor = executions.get(executorId).executor;

          executor.on("stdout", (message) => {
            socket.send(JSON.stringify({
              type: "stdout",
              message: message,
              htmlMessage: converter.toHtml(message.replace(/>/g, "&gt;").replace(/</g, "&lt;").replace(/\n/g, "<br>").replace(/ /g, "&nbsp;")
              )
            }))
          });

          executor.on("stderr", (message) => {
            console.log(message);
          });

          executor.on("exit", () => {
            socket.send(JSON.stringify({
              type: "done"
            }));
            socket.close();
          });

          hasStarted = true;

          executor.execute();
          break;
        case "stdin":
          if (hasStarted) {
            const ex = executions.get(executorId).executor;
            ex.sendStdin(json.message);
          }
          break;
      }
    } catch (err) {
      socket.send(JSON.stringify({
        type: "error",
        message: err.message
      }));
    }
  });
});


// Listen
const server = app.listen(config.port, () => {
  console.log(`Listening on port ${config.port}`);
});

// Setup ws
server.on('upgrade', (request, socket, head) => {
  wsServer.handleUpgrade(request, socket, head, socket => {
    wsServer.emit('connection', socket, request);
  });
});