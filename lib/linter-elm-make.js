"use babel";

const BufferedProcess = require('atom').BufferedProcess;

module.exports = {
  config: {
    elmMakeExecutablePath: {
      title: 'The elm-make executable path.',
      type: 'string',
      default: '/usr/local/bin/elm-make',
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
          const options = {
            cwd: atom.project.getPaths()[0],
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
              const colorize = ((msg) => {
                return msg.split("[33m").join("<span style='color:orange'>")
                  .split("[0m").join("</span>")
                  .split(" `").join(" `<span style='font-weight:bold'>")
                  .split("` ").join("</span>` ");
              })
              if (atom.inDevMode()) {
                console.log(json);
              }
              if (!json) {
                return resolve([]);
              }
              const errors = json.map((error) => {
                return {
                  type: error.type,
                  html: `<div>${colorize(error.overview)}</div><br/>${colorize(error.details.split('\n').join('<br/>&nbsp;'))}<br/><br/>`,
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
