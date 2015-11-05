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
          const lines = [];
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
          const process = new BufferedProcess({
            command: executablePath,
            args: [filePath, '--warn', '--report=json', '--output=/dev/null'],
            options: options,
            stdout(data) {
              lines.push(data);
            },
            exit(code) {
              const text = lines[0];
              const json = (() => {
                try {
                  return JSON.parse(text.slice(0, text.indexOf("\n")));
                } catch (_error) {}
              })();
              if (atom.inDevMode()) {
                console.log(json);
              }
              if (!json) {
                return resolve([]);
              }
              const errors = json.map((error) => {
                return {
                  type: error.type,
                  html: `${error.overview}<br/><br/>${error.details.split('\n').join('<br/>&nbsp;')}`,
                  filePath: error.file || filePath,
                  range: [
                    [error.region.start.line - 1, error.region.start.column - 1],
                    [error.region.end.line - 1, error.region.end.column - 1]
                  ]
                };
              });
              resolve(errors);
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
  }
};

function lookupElmPackage(directory) {
  if (fs.existsSync(path.join(directory, "elm-package.json"))) {
    return directory;
  } else {
    const parentDirectory = path.join(directory, "..");
    if (fs.existsSync(parentDirectory)) {
      return lookupElmPackage(parentDirectory);
    } else {
      return null;
    }
  }
}
