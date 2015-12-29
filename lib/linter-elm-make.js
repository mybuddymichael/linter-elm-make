"use babel";

const BufferedProcess = require('atom').BufferedProcess;
const path = require("path");
const fs = require("fs");

module.exports = {
  config: {
    elmMakeExecutablePath: {
      title: 'The elm-make executable path.',
      type: 'string',
      default: 'elm-make',
    }
  },
  activate() {
    if (!atom.packages.getLoadedPackage('language-elm')) {
      atom.notifications.addError("The Elm language package wasn't found.", {
        detail: 'Please install the `language-elm` package in your Settings view.'
      });
    }
    if (!atom.packages.getLoadedPackage('linter')) {
      atom.notifications.addError('The linter package not found.', {
        detail: 'Please install the `linter` package in your Settings view'
      });
    }
  },
  provideLinter() {
    const proc = process;
    return {
      grammarScopes: ['source.elm'],
      scope: 'file',
      lintOnFly: false,
      lint(textEditor) {
        return new Promise((resolve, reject) => {
          const filePath = textEditor.getPath();
          const executablePath = atom.config.get('linter-elm-make.elmMakeExecutablePath');
          const cwd = lookupElmPackage(path.dirname(textEditor.getPath()));
          if (cwd === null) {
            atom.notifications.addError("No elm-package.json beneath or above the edited file", {
            });
            return;
          }
          const options = {
            cwd: cwd,
            env: proc.env
          };
          const stderrLines = [];
          const progressIndicator = module.statusBar.addLeftTile({
            item: createProgressIndicator(),
            priority: 1
          });
          const process = new BufferedProcess({
            command: executablePath,
            args: [filePath, '--warn', '--report=json', '--output=/dev/null', '--yes'],
            options: options,
            stdout(data) {
              const problemsByLine = data.split('\n').map((line) => {
                const json = (() => {
                  try {
                    return JSON.parse(line);
                  } catch (error) {
                    // elm-make outputs other lines besides the report
                  }
                })();
                if (!json) {
                  return [];
                } else {
                  return json.map((problem) => {
                    const colorize = ((msg) => {
                      return msg.split("[33m").join("<span style='color:orange'>")
                        .split("[0m").join("</span>")
                        .split(" `").join(" `<span style='font-weight:bold'>")
                        .split("` ").join("</span>` ");
                    });
                    return {
                      type: problem.type,
                      html: `${colorize(problem.overview)}<br/><br/>${colorize(problem.details.split('\n').join('<br/>&nbsp;'))}`,
                      filePath: problem.file || filePath,
                      range: [
                        [problem.region.start.line - 1, problem.region.start.column - 1],
                        [problem.region.end.line - 1, problem.region.end.column - 1]
                      ]
                    };
                  });
                }
              });
              const allProblems = [].concat.apply([], problemsByLine);
              resolve(allProblems);
              progressIndicator.destroy();
            },
            stderr(data) {
              stderrLines.push(data);
            },
            exit(code) {
              var lineNumber = 0;
              const lineNumberRegexp = /^(\d+)\|.*/g;
              stderrLines.forEach((line) => {
                const matches = lineNumberRegexp.exec(line);
                if (matches !== null) {
                  matches.forEach((match) => {
                    lineNumber = parseInt(match) - 1;
                  });
                }
              });
              resolve([
                {
                  type: "error",
                  html: `${stderrLines.join('<br/>')}`,
                  filePath: filePath,
                  range: [
                    [lineNumber, 0],
                    [lineNumber, 0]
                  ] // TODO search for invalid import
                }
              ]);
              progressIndicator.destroy();
            }
          });
          process.onWillThrowError(({error, handle}) => {
            atom.notifications.addError("Failed to run " + executablePath, {
              detail: error.message
            });
            handle();
            return resolve([]);
          });
        });
      }
    };
  },
  consumeStatusBar(statusBar) {
    module.statusBar = statusBar;
  }
};

function createProgressIndicator() {
  const result = document.createElement("div");
  result.classList.add("inline-block");
  result.classList.add("icon-ellipsis");
  result.innerHTML = "Linting...";
  return result;
}

function lookupElmPackage(directory) {
  if (fs.existsSync(path.join(directory, "elm-package.json"))) {
    return directory;
  } else {
    const parentDirectory = path.join(directory, "..");
    if (parentDirectory === directory) {
      return null;
    } else {
      return lookupElmPackage(parentDirectory);
    }
  }
}
