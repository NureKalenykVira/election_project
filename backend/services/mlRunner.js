const { spawn } = require("child_process");
const path = require("path");

const PYTHON =
  process.env.ML_PYTHON || "python";

const ML_SCRIPTS_DIR = path.resolve(
  process.cwd(),
  process.env.ML_SCRIPTS_DIR || "../ml"
);

function runScript(scriptName) {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(ML_SCRIPTS_DIR, scriptName);
    console.log(`[ML] Starting ${scriptPath} ...`);

    const child = spawn(PYTHON, [scriptPath], {
      cwd: ML_SCRIPTS_DIR,
      stdio: "inherit",
    });

    child.on("error", (err) => {
      console.error(`[ML] Failed to start ${scriptName}:`, err);
      reject(err);
    });

    child.on("exit", (code) => {
      if (code === 0) {
        console.log(`[ML] ${scriptName} finished with code 0`);
        resolve();
      } else {
        const err = new Error(
          `${scriptName} exited with code ${code}`
        );
        console.error("[ML]", err.message);
        reject(err);
      }
    });
  });
}

async function runAllAnalyses() {
  try {
    console.log("[ML] Running Isolation Forest...");
    await runScript("isolation_forest_runner.py");

    console.log("[ML] Running KMeans...");
    await runScript("kmeans_runner.py");

    console.log("[ML] Running Logistic Regression...");
    await runScript("logreg_runner.py");

    console.log("[ML] All analyses completed.");
  } catch (err) {
    console.error("[ML] Error in runAllAnalyses:", err);
  }
}

module.exports = {
  runAllAnalyses,
};
