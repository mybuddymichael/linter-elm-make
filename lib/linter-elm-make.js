"use babel";

const QuickFixView = require('./quick-fix-view');
const BufferedProcess = require('atom').BufferedProcess;
const Range = require('atom').Range;
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
    module.exports.fixesByRange = [];
    module.exports.quickFixView = new QuickFixView();
    module.exports.quickFixView.onDidConfirm(({textEditor, range, fix}) => {
      fixProblem(textEditor, range, fix);
    });
    atom.commands.add('atom-text-editor', {
      'linter-elm-make:quick-fix': module.exports.quickFix
    });
  },
  deactivate() {
    module.exports.quickFixView.destroy();
  },
  quickFix() {
    var textEditor = atom.workspace.getActiveTextEditor();
    const textEditorPath = textEditor.getPath();
    const position = textEditor.getLastCursor().getBufferPosition();
    // Look for fixes for the issue at cursor position.
    var fixesForPosition = null;
    const BreakException = {};
    try {
      module.exports.fixesByRange
      .filter(({filePath}) => { return textEditorPath === filePath; })
      .forEach(({range, fixes}) => {
        if (range.containsPoint(position)) {
          // Fix found! Get out of loop.
          fixesForPosition = {range, fixes};
          throw BreakException;
        }
      });
    } catch(e) {
      if (e!==BreakException) throw e;
    }
    if (fixesForPosition) {
      module.exports.quickFixView.show(textEditor, fixesForPosition.range, fixesForPosition.fixes);
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
                      range: new Range(
                        [problem.region.start.line - 1, problem.region.start.column - 1],
                        [problem.region.end.line - 1, problem.region.end.column - 1]
                      ),
                      fixes: getFixesForProblem(problem)
                    };
                  });
                }
              });
              const allProblems = [].concat.apply([], problemsByLine);
              // Naive implementation. Just stores fixes in an array.
              module.exports.fixesByRange =
                allProblems
                .filter(({fixes}) => { return fixes !== null; })
                .map(({filePath, range, fixes}) => {
                  return {
                    filePath: filePath,
                    range: range,
                    fixes: fixes
                  };
                });
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

function getFixesForProblem(problem) {
  switch (problem.tag) {
    case 'NAMING ERROR':
      if (!problem.suggestions) {
        return null;
      }
      return problem.suggestions.map((suggestion) => {
        return {
          type: 'Replace',
          text: suggestion
        };
      });
    case 'missing type annotation':
      return [{
        type: 'Add type annotation',
        text: problem.details.match(/I inferred the type annotation so you can copy it into your code:\n\n(.*)$/)[1]
      }];
    default:
      console.error('Unhandled problem tag: ' + problem.tag);
      return null;
  }
}

function fixProblem(textEditor, range, fix) {
  switch (fix.type) {
    case 'Replace':
      textEditor.setTextInBufferRange(range, fix.text);
      break;
    case 'Add type annotation':
      // Insert type annotation above the line.
      textEditor.transact(() => {
        textEditor.setCursorBufferPosition(range.start);
        const leadingSpaces = new Array(range.start.column).join(' ');
        textEditor.insertText(fix.text + '\n' + leadingSpaces);
      });
      break;
  }
}
