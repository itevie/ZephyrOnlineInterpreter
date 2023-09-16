const fs = require("fs");
const path = require("path");
const childProcess = require('child_process');
const config = require(__dirname + "/config.json");

class Executor {
  /**
   * The file name (./fileId.zr)
   * @type {string}
   */
  fileId = null;
  args = [];

  /**
   * The file name
   * @type {string}
   */
  sourceCodeDestination = null;

  /**
   * @type {object}
   */
  events = {
    stdout: null,
    stderr: null,
    exit: null,
  };

  /**
   * @type {childProcess.ChildProcessWithoutNullStreams}
   */
  #process = null;

  /**
   * Initiates the executor
   * @param {string} sourceCode The source code to run
   */
  constructor(sourceCode, args) {
    this.args = args;

    // Create the file
    this.fileId = Date.now();
    this.sourceCodeDestination = path.join(__dirname, "programs", `${this.fileId}.zr`);
    fs.writeFileSync(this.sourceCodeDestination, sourceCode);
  }

  /**
   * For listening to events to do with execution
   * @param {"stdout"|"exit"|"stderr"} event The event name
   * @param {function} callback The function to run once event is ran
   */
  on(event, callback) {
    if (!this.events.hasOwnProperty(event))
      throw `Event ${event} does not exist!`;
    this.events[event] = callback;
  }

  /**
   * Calls an event
   * @param {string} event Event name
   * @param {*} data The data to provide
   */
  callEvent(event, data) {
    if (this.events[event]) {
      this.events[event](data);
    }
  }

  /**
   * Executes the file
   */
  execute() {
    const zephyrExecutable = config.executable;

    this.args.push(`--file=${this.sourceCodeDestination}`);

    // Spawn it
    this.#process = childProcess.spawn(zephyrExecutable, this.args, {
      cwd: config.cwd
    });
    process.stdin.setEncoding('utf-8');

    // Register events
    this.#process.stdout.on('data', (data) => {
      const stringData = Buffer.from(data).toString();
      this.callEvent('stdout', stringData);
    });

    this.#process.stderr.on('data', (data) => {
      console.log(Buffer.from(data).toString())
    })

    this.#process.on('exit', () => {
      this.dipose();
      this.callEvent('exit', null);
    });
  }

  /**
   * Sends stdin input to the process
   * @param {string} string 
   */
  sendStdin(string) {
    if (this.#process == null) {
      throw "Process not started";
    }

    // Send it
    this.#process.stdin.write(string + "\r\n");
    //this.#process.stdin.end();
  }

  /**
   * Cleans up
   */
  dipose() {
    // Try delete the program
    try {
      fs.rmSync(this.sourceCodeDestination);
    } catch {}
  }
}


const Convert = require('ansi-to-html');
const converter = new Convert();

module.exports = Executor;

/*const ex = new Executor("console.writeLine(Process);", [
  "--file-access=n",
  "--max-iterations=10000",
  "--os-apis=false",
  "--can-spawn-processes=false"
]);
ex.on("stdout", (data) => {
  process.stdout.write(converter.toHtml(data));
});
ex.on("exit", (data) => {
  console.log("\nFinished!");
})
ex.execute();
ex.sendStdin("Woah wtf");*/