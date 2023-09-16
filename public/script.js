let editor = null;

document.addEventListener("DOMContentLoaded", async () => {
  require.config({ paths: { 'vs': 'https://unpkg.com/monaco-editor@latest/min/vs' }});
  window.MonacoEnvironment = { getWorkerUrl: () => proxy };

  let proxy = URL.createObjectURL(new Blob([`
    self.MonacoEnvironment = {
      baseUrl: 'https://unpkg.com/monaco-editor@latest/min/'
    };
    importScripts('https://unpkg.com/monaco-editor@latest/min/vs/base/worker/workerMain.js');
  `], { type: 'text/javascript' }));

  require(["vs/editor/editor.main"], function () {
    editor = monaco.editor.create(document.getElementById('editor-container'), {
      value: [
`// All functions currently
console.writeLine({
  Any, Array, console, Evaluator, Event, Files, Float, Integer, Json, Math, Modifiers,
  Net, Object, Process, Random, Regex, _scope, String, Threading, Timers, Variable
});

// Try loading a preset from the bottom right!
`
      ].join('\n'),
      theme: 'vs-dark',
    });

    window.onresize = function (){
      editor.layout({ width: 0, height: 0});

      window.requestAnimationFrame(() => {
        const rect = document.getElementById("editor-container").getBoundingClientRect();
        editor.layout({ width: rect.width, height: rect.height })
      })
    };
  });

  // Load presets
  const presetsRes = await fetch("/presets");
  const presets = (await presetsRes.json()).presets;

  for (const preset of presets) {
    const option = document.createElement("option");
    option.text = preset;
    option.value = preset;
    document.getElementById("preset-select").add(option);
  }

  // Wait for monaco to load
  setTimeout(async () => {
    // Check the params
    let params = (new URL(document.location)).searchParams;

    // Check auto-load preset
    let preset = params.get("preset");
    if (preset) await loadPreset(preset);

    // Check for auto-run
    if (params.has("autorun")) run();
  }, 500);

  reloadUI(true);
});

function reloadUI(resetReults) {
  document.getElementById("run-button").innerHTML = "Run";
  document.getElementById("run-button").disabled = false;

  if (resetReults) {
    document.getElementById("results").innerHTML = `<center><i>Click Run to get output</i></center>`;
  }

  if (document.getElementById("running-status")) {
    document.getElementById("results").innerHTML = ``;
  }
}

function run() {
  // Setup UI
  document.getElementById("run-button").innerHTML = "Running...";
  document.getElementById("run-button").disabled = true;
  document.getElementById("results").innerHTML = `<center><img class="loader" src="/loader.gif"><br><label id="running-status"></label></center>`;

  function setStatus(text) {
    document.getElementById("running-status").innerHTML = text;
  }

  function error(text) {
    reloadUI();
    document.getElementById("results").innerHTML = `<center><label style="color: red">Error: ${text}</label></center>`;
  }

  setStatus("Initialising...");

  // Collect source
  let sourceCode = editor.getValue();
  sourceCode = `console.write("");` + sourceCode;

  try {
    // Intialise it
    fetch("/execute", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        source: sourceCode
      })
    }).then(async res => {
      const text = await res.text();

      if (!res.ok) {
        error(`Failed to execute program: [${res.status} - ${res.statusText}]: ${text}`);
        return;
      }

      // Get id
      const json = JSON.parse(text);
      const id = json.executionId;
      setStatus(`Connecting...<br>ID: ${id}`);

      // Connect to WS
      const socket = new WebSocket(`ws${location.protocol.includes("s") ? "s" : ""}://${location.hostname}${location.port ? `:${location.port}` : ""}/`);

      socket.onopen = function() {
        setStatus("Authenticating...");
        socket.send(JSON.stringify({
          type: "auth",
          id: id
        }));
      }

      socket.onclose = function() {
        try {
          setStatus("WS Connection Closed");
        } catch {}
        reloadUI();
      }
      
      const resultsDiv = document.getElementById("results")
      let hasListener = false;

      function updateStdin() {
        resultsDiv.lastChild.after(document.getElementById("stdin"));
        document.getElementById("stdin").addEventListener("keydown", (e) => {
          if (e.key == "Enter") {
            // Send STDIN
            socket.send(JSON.stringify({
              type: "stdin",
              message: document.getElementById("stdin").value
            }));
            addItem(`${document.getElementById("stdin").value}<br>`);
            document.getElementById("stdin").value = "";
            updateStdin();
          }
        });
        document.getElementById("stdin").focus();
      }

      function addItem(text) {
        document.getElementById("results").innerHTML += text;
        document.getElementById("results").scrollTo({ top: document.getElementById("results").scrollHeight, behavior: 'auto' });
      }

      let firstStdout = true;

      socket.onmessage = function(event) {
        const wsJson = JSON.parse(event.data);

        switch (wsJson.type) {
          case "ready":
            setStatus("Waiting for first output...");
            socket.send(JSON.stringify({
              type: "start"
            }));
            break;
          case "stdout":
            if (firstStdout) {
              document.getElementById("results").innerHTML = "";

              let textBox = document.createElement("input");
              textBox.id = "stdin";
              textBox.classList.add("stdin");
              document.getElementById("results").appendChild(textBox);
              textBox.focus();
              updateStdin();
              firstStdout = false;
            }
            addItem(wsJson.htmlMessage);
            updateStdin();
            break;
          case "done":
            reloadUI();
            addItem(`<i>Program exited</i>`);
            resultsDiv.removeChild(document.getElementById("stdin"));
            break;
          case "error":
            reloadUI();
            addItem(`<br><i style="color: red">Error: ${wsJson.message}</i>`);
            addItem(`<br><i>Program exited</i>`);
            resultsDiv.removeChild(document.getElementById("stdin"));
            break;
        }
      }
    })
  } catch (err) {
  }
}

async function loadPreset(name) {
  // Get the selected option
  const presetSelect = document.getElementById("preset-select");
  const value = name || presetSelect.options[presetSelect.selectedIndex].value;

  // user has not selected a preset
  if (value == "Select a preset") {
    return Swal.fire({
      title: "Oops",
      text: "Please select a preset",
      icon: "warning"
    });
  }

  async function loadPreset() {
    // Fetch the preset data
    const val = await fetch(`/presets/${value}`);
    editor.getModel().setValue(await val.text());
  }

  if (name) return loadPreset();

  // Confirm user wants to override
  Swal.fire({
    title: "Confirm",
    text: `Are you sure you want to override your current document with the preset ${value}?`,
    icon: "question",
    showCancelButton: true
  }).then(async res => {
    if (res.isConfirmed) {
      loadPreset();
    }
  })
}